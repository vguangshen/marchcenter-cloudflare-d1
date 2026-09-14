import com.alibaba.fastjson.JSON;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import com.itmc.train.newService.impl.NewTrainingInterfaceUtilService;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.Permission;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Deque;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Local-only wire capture for the official JAVA class lifecycle operations
 * (markGroupDeleted / delDataByClassName / checkClass) from the
 * NewTrainingInterfaceUtilService REST interface.
 */
public final class JavaClassDeleteCapture {
    private static volatile Active active;

    private interface Invocation {
        Object invoke(String baseUrl) throws Throwable;
    }

    private static final class Scenario {
        final String name;
        final Map<String, Object> input;
        final Invocation invocation;
        final Map<String, Deque<String>> responses = new LinkedHashMap<String, Deque<String>>();

        Scenario(String name, Map<String, Object> input, Invocation invocation) {
            this.name = name;
            this.input = input;
            this.invocation = invocation;
        }

        Scenario respond(String path, String rawResult) {
            Deque<String> queue = responses.get(path);
            if (queue == null) {
                queue = new ArrayDeque<String>();
                responses.put(path, queue);
            }
            queue.addLast(rawResult);
            return this;
        }
    }

    private static final class Active {
        final Scenario scenario;
        final List<Map<String, Object>> calls = new ArrayList<Map<String, Object>>();

        Active(Scenario scenario) {
            this.scenario = scenario;
        }
    }

    private static void installLoopbackOnlyNetworkGuard() {
        System.setSecurityManager(new SecurityManager() {
            @Override
            public void checkPermission(Permission permission) {
                // Files and reflection remain available to the official runtime.
            }

            @Override
            public void checkConnect(String host, int port) {
                rejectNonLoopback(host, port);
            }

            @Override
            public void checkConnect(String host, int port, Object context) {
                rejectNonLoopback(host, port);
            }

            private void rejectNonLoopback(String host, int port) {
                if (host == null) return;
                try {
                    if (InetAddress.getByName(host).isLoopbackAddress()) return;
                } catch (Exception ignored) {
                    // Rejected below.
                }
                throw new SecurityException("non-loopback network access blocked: " + host + ":" + port);
            }
        });
    }

    private static String readBody(HttpExchange exchange) throws java.io.IOException {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[4096];
        int read;
        while ((read = exchange.getRequestBody().read(buffer)) >= 0) output.write(buffer, 0, read);
        return new String(output.toByteArray(), StandardCharsets.UTF_8);
    }

    private static String sanitizeToken(String value) {
        return value == null || value.isEmpty() ? "" : "[REDACTED]";
    }

    private static void handle(HttpExchange exchange) throws java.io.IOException {
        Active current = active;
        String path = exchange.getRequestURI().getPath();
        Deque<String> queue = current.scenario.responses.get(path);
        boolean fallback = queue == null || queue.isEmpty();
        String rawResult = fallback ? "{\"code\":10000,\"succ\":true,\"message\":\"ok\",\"data\":true}" : queue.removeFirst();

        Map<String, Object> call = new LinkedHashMap<String, Object>();
        call.put("sequence", current.calls.size() + 1);
        call.put("path", path);
        Map<String, String> headers = new LinkedHashMap<String, String>();
        headers.put("Content-Type", exchange.getRequestHeaders().getFirst("Content-Type"));
        headers.put("platformToken", sanitizeToken(exchange.getRequestHeaders().getFirst("platformToken")));
        call.put("headers", headers);
        call.put("form", readBody(exchange));
        call.put("mockResult", rawResult);
        call.put("fallbackResponse", fallback);
        current.calls.add(call);

        byte[] bytes = rawResult.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
        exchange.sendResponseHeaders(200, bytes.length);
        try (OutputStream output = exchange.getResponseBody()) {
            output.write(bytes);
        }
    }

    private static Map<String, Object> inputOf(Object... pairs) {
        Map<String, Object> input = new LinkedHashMap<String, Object>();
        for (int index = 0; index + 1 < pairs.length; index += 2) input.put(String.valueOf(pairs[index]), pairs[index + 1]);
        return input;
    }

    private static List<Scenario> scenarios() {
        List<Scenario> all = new ArrayList<Scenario>();
        all.add(new Scenario(
            "mark-group-deleted",
            inputOf("groupID", "group-1"),
            new Invocation() {
                public Object invoke(String baseUrl) throws Throwable {
                    return new NewTrainingInterfaceUtilService().getService(baseUrl).markGroupDeleted("group-1");
                }
            }
        ).respond("/open/tokenInfo", "{\"code\":10000,\"succ\":true,\"message\":\"ok\",\"data\":\"TOKEN-LOCAL\"}")
            .respond("/open/markGroupDeleted", "{\"code\":10000,\"succ\":true,\"message\":\"ok\",\"data\":true}"));

        all.add(new Scenario(
            "del-data-by-class-name",
            inputOf("className", "mcuser"),
            new Invocation() {
                public Object invoke(String baseUrl) throws Throwable {
                    return new NewTrainingInterfaceUtilService().getService(baseUrl).delDataByClassName("mcuser");
                }
            }
        ).respond("/open/tokenInfo", "{\"code\":10000,\"succ\":true,\"message\":\"ok\",\"data\":\"TOKEN-LOCAL\"}")
            .respond("/open/delDataByClassName", "{\"code\":10000,\"succ\":true,\"message\":\"ok\",\"data\":true}"));

        all.add(new Scenario(
            "check-class",
            inputOf("className", "class-local"),
            new Invocation() {
                public Object invoke(String baseUrl) throws Throwable {
                    return new NewTrainingInterfaceUtilService().getService(baseUrl).checkClass("class-local");
                }
            }
        ).respond("/open/tokenInfo", "{\"code\":10000,\"succ\":true,\"message\":\"ok\",\"data\":\"TOKEN-LOCAL\"}")
            .respond("/open/checkClass", "{\"code\":10000,\"succ\":true,\"message\":\"ok\",\"data\":\"group-1\"}"));

        all.add(new Scenario(
            "reinitialize-system",
            inputOf(),
            new Invocation() {
                public Object invoke(String baseUrl) throws Throwable {
                    return new NewTrainingInterfaceUtilService().getService(baseUrl).reinitializeSystem();
                }
            }
        ).respond("/open/tokenInfo", "{\"code\":10000,\"succ\":true,\"message\":\"ok\",\"data\":\"TOKEN-LOCAL\"}")
            .respond("/open/reinitializeSystem", "{\"code\":10000,\"succ\":true,\"message\":\"ok\",\"data\":true}"));
        return all;
    }

    private static Map<String, Object> execute(Scenario scenario, String baseUrl) {
        Active current = new Active(scenario);
        active = current;
        Map<String, Object> entry = new LinkedHashMap<String, Object>();
        entry.put("name", scenario.name);
        entry.put("evidenceLevel", "official-captured");
        entry.put("input", scenario.input);
        try {
            Object outcome = scenario.invocation.invoke(baseUrl);
            entry.put("outcome", outcome == null ? null : outcome.toString());
        } catch (Throwable error) {
            entry.put("exception", error.getClass().getName() + ": " + error.getMessage());
        }
        entry.put("calls", new ArrayList<Map<String, Object>>(current.calls));
        return entry;
    }

    private static String sha256(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (FileInputStream input = new FileInputStream(file)) {
            byte[] buffer = new byte[8192];
            int read;
            while ((read = input.read(buffer)) >= 0) digest.update(buffer, 0, read);
        }
        StringBuilder hex = new StringBuilder();
        for (byte value : digest.digest()) hex.append(String.format("%02x", value & 0xff));
        return hex.toString();
    }

    public static void main(String[] args) throws Exception {
        if (args.length != 2) throw new IllegalArgumentException("expected: fixturePath officialJarPath");
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", JavaClassDeleteCapture::handle);
        server.start();
        installLoopbackOnlyNetworkGuard();
        String baseUrl = "http://127.0.0.1:" + server.getAddress().getPort();

        List<Map<String, Object>> captured = new ArrayList<Map<String, Object>>();
        try {
            for (Scenario scenario : scenarios()) captured.add(execute(scenario, baseUrl));
        } finally {
            server.stop(0);
        }

        Map<String, Object> root = new LinkedHashMap<String, Object>();
        root.put("schemaVersion", 1);
        root.put("source", "official itmc-tool-train-1.7.3.jar NewTrainingInterfaceUtilService class lifecycle against loopback-only mock");
        root.put("evidenceLevel", "official-captured");
        root.put("localhostOnly", Boolean.TRUE);
        root.put("productionTraffic", Boolean.FALSE);
        root.put("artifact", "itmc-tool-train-1.7.3.jar");
        root.put("artifactSha256", sha256(new File(args[1])));
        root.put("redactions", Arrays.asList("platformToken"));
        root.put("scenarioCount", captured.size());
        root.put("scenarios", captured);

        byte[] json = JSON.toJSONString(root, true).getBytes(StandardCharsets.UTF_8);
        File outputFile = new File(args[0]);
        File parent = outputFile.getParentFile();
        if (parent != null) parent.mkdirs();
        try (FileOutputStream output = new FileOutputStream(outputFile)) {
            output.write(json);
        }
        System.out.println("WROTE " + outputFile.getAbsolutePath());
    }
}
