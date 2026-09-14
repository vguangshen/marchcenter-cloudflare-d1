import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.itmc.train.newService.impl.ShichangyingxiaoshapanInterfaceUtilService;
import com.itmc.train.webservice.shapan_shichangyingxiao.StudentBaseClass;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import entrance.TrainingEntrance;

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

public final class MarketingAddStudentCapture {
    private static final String MARKETING = "ShichangyingxiaoshapanInterfaceUtilService";
    private static volatile ActiveScenario active;

    private interface Invocation {
        Object invoke(String baseUrl) throws Throwable;
    }

    private static final class Scenario {
        final String name;
        final String invocationKind;
        final Map<String, Object> input;
        final Invocation invocation;
        final Map<String, Deque<String>> responses = new LinkedHashMap<String, Deque<String>>();

        Scenario(String name, String invocationKind, Map<String, Object> input, Invocation invocation) {
            this.name = name;
            this.invocationKind = invocationKind;
            this.input = input;
            this.invocation = invocation;
        }

        Scenario respond(String operationName, String rawResult) {
            Deque<String> queue = responses.get(operationName);
            if (queue == null) {
                queue = new ArrayDeque<String>();
                responses.put(operationName, queue);
            }
            queue.addLast(rawResult);
            return this;
        }
    }

    private static final class ActiveScenario {
        final Scenario scenario;
        final List<Map<String, Object>> calls = new ArrayList<Map<String, Object>>();

        ActiveScenario(Scenario scenario) {
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

    private static String operationName(HttpExchange exchange) {
        String action = exchange.getRequestHeaders().getFirst("SOAPAction");
        if (action == null) return "Unknown";
        action = action.replace("\"", "");
        return action.substring(action.lastIndexOf('/') + 1);
    }

    private static String sanitizeRequestXml(String xml) {
        return xml
            .replaceAll("(?is)(<clientinfo[^>]*>.*?<Uname>).*?(</Uname>)", "$1[REDACTED]$2")
            .replaceAll("(?is)(<clientinfo[^>]*>.*?<Password>).*?(</Password>)", "$1[REDACTED]$2");
    }

    private static String xmlEscape(String text) {
        return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;");
    }

    private static String soapEnvelope(String operation, String rawResult) {
        return "<?xml version=\"1.0\" encoding=\"utf-8\"?>"
            + "<soapenv:Envelope xmlns:soapenv=\"http://schemas.xmlsoap.org/soap/envelope/\">"
            + "<soapenv:Body><" + operation + "Response xmlns=\"http://tempuri.org/\">"
            + "<" + operation + "Result>" + xmlEscape(rawResult) + "</" + operation + "Result>"
            + "</" + operation + "Response></soapenv:Body></soapenv:Envelope>";
    }

    private static void handle(HttpExchange exchange) throws java.io.IOException {
        ActiveScenario current = active;
        String operation = operationName(exchange);
        Deque<String> queue = current.scenario.responses.get(operation);
        boolean fallback = queue == null || queue.isEmpty();
        String rawResult = fallback ? resultDataString("[]") : queue.removeFirst();
        String responseXml = soapEnvelope(operation, rawResult);

        Map<String, Object> call = new LinkedHashMap<String, Object>();
        call.put("sequence", current.calls.size() + 1);
        call.put("operationName", operation);
        call.put("endpoint", "http://127.0.0.1:" + exchange.getLocalAddress().getPort() + exchange.getRequestURI());
        Map<String, String> headers = new LinkedHashMap<String, String>();
        headers.put("Content-Type", exchange.getRequestHeaders().getFirst("Content-Type"));
        headers.put("SOAPAction", exchange.getRequestHeaders().getFirst("SOAPAction"));
        headers.put("User-Agent", exchange.getRequestHeaders().getFirst("User-Agent"));
        call.put("headers", headers);
        call.put("requestXml", sanitizeRequestXml(readBody(exchange)));
        call.put("mockResult", rawResult);
        call.put("mockResponseXml", responseXml);
        call.put("fallbackResponse", fallback);
        current.calls.add(call);

        byte[] bytes = responseXml.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "text/xml; charset=utf-8");
        exchange.sendResponseHeaders(200, bytes.length);
        try (OutputStream output = exchange.getResponseBody()) {
            output.write(bytes);
        }
    }

    private static Map<String, Object> directInput(StudentBaseClass[] students, String groupID,
                                                    long st, long ed, int maxRunYear, boolean autoDeal) {
        Map<String, Object> input = new LinkedHashMap<String, Object>();
        List<Map<String, Object>> studentValues = new ArrayList<Map<String, Object>>();
        for (StudentBaseClass student : students) {
            Map<String, Object> item = new LinkedHashMap<String, Object>();
            item.put("studentID", student.getStudentID());
            item.put("password", student.getPassword());
            item.put("nickName", student.getNickName());
            studentValues.add(item);
        }
        input.put("studentList", studentValues);
        input.put("groupID", groupID);
        input.put("st", String.valueOf(st));
        input.put("ed", String.valueOf(ed));
        input.put("maxRunYear", Integer.valueOf(maxRunYear));
        input.put("autoDeal", Boolean.valueOf(autoDeal));
        return input;
    }

    private static Scenario directScenario(String name, final StudentBaseClass[] students, final String groupID,
                                           final long st, final long ed, final int maxRunYear,
                                           final boolean autoDeal) {
        Scenario scenario = new Scenario(
            name,
            "official-axis-stub-direct",
            directInput(students, groupID, st, ed, maxRunYear, autoDeal),
            new Invocation() {
                @Override
                public Object invoke(String baseUrl) throws Throwable {
                    ShichangyingxiaoshapanInterfaceUtilService factory =
                        new ShichangyingxiaoshapanInterfaceUtilService();
                    ShichangyingxiaoshapanInterfaceUtilService service = factory.getService(baseUrl);
                    return service.addStudent(students, groupID, st, ed, maxRunYear, autoDeal);
                }
            }
        );
        return scenario.respond("AddStudent", resultDataString("[\"captured\"]"));
    }

    private static JSONObject highLevelParameters() {
        JSONObject parameters = new JSONObject(true);
        parameters.put("loginName", "student");
        parameters.put("className", "class-local");
        parameters.put("teacherUserName", "teacher");
        parameters.put("startTime", "1");
        parameters.put("endTime", "2");
        parameters.put("flag", "1");
        parameters.put("trainOrExam", "train");
        parameters.put("userId", Long.valueOf(1));
        parameters.put("userName", "Student Local");
        parameters.put("startExam", Boolean.FALSE);
        parameters.put("classType", Integer.valueOf(1));
        parameters.put("maxRunYear", Integer.valueOf(0));
        parameters.put("autoDeal", Boolean.FALSE);
        parameters.put("roleName", "student");
        parameters.put("teamName", "");
        return parameters;
    }

    private static Scenario highLevelScenario(String name, Object maxRunYear, boolean missing) {
        final JSONObject parameters = highLevelParameters();
        if (missing) parameters.remove("maxRunYear");
        else parameters.put("maxRunYear", maxRunYear);
        Map<String, Object> input = JSON.parseObject(parameters.toJSONString(), LinkedHashMap.class);
        Scenario scenario = new Scenario(name, "training-entrance", input, new Invocation() {
            @Override
            public Object invoke(String baseUrl) throws Throwable {
                return new TrainingEntrance().executeNew(
                    MARKETING,
                    "commonReturnStudentBaseInfo",
                    parameters,
                    baseUrl
                );
            }
        });
        return scenario
            .respond("IsGroupExisted", resultDataString("group-1"))
            .respond("IsStuExisted", resultDataString("[]"))
            .respond("AddStudent", resultDataString("[\"student\"]"));
    }

    private static List<Scenario> scenarios() {
        List<Scenario> scenarios = new ArrayList<Scenario>();
        StudentBaseClass one = new StudentBaseClass("student-1", "pw", "Student One");
        scenarios.add(directScenario("max-zero-auto-false", new StudentBaseClass[]{one}, "group-1", 1L, 2L, 0, false));
        scenarios.add(directScenario("max-ten-auto-true", new StudentBaseClass[]{one}, "group-1", 11L, 22L, 10, true));
        scenarios.add(directScenario("times-zero", new StudentBaseClass[]{one}, "group-1", 0L, 0L, 0, false));
        scenarios.add(directScenario("long-maximum", new StudentBaseClass[]{one}, "group-1", Long.MAX_VALUE, Long.MAX_VALUE, 10, true));
        scenarios.add(directScenario(
            "multiple-students",
            new StudentBaseClass[]{
                new StudentBaseClass("student-a", "p-a", "Student A"),
                new StudentBaseClass("student-b", "p-b", "Student B")
            },
            "group-1", 1L, 2L, 0, false
        ));
        scenarios.add(directScenario(
            "chinese-and-xml-special",
            new StudentBaseClass[]{new StudentBaseClass("学生&<一>\"'", "密码&<>\"'", "姓名中文&<>\"'")},
            "班级&<>\"'", 1L, 2L, 0, false
        ));
        scenarios.add(directScenario(
            "null-optional-fields",
            new StudentBaseClass[]{new StudentBaseClass("student-null", null, null)},
            "group-1", 1L, 2L, 0, false
        ));
        scenarios.add(highLevelScenario("max-null", null, false));
        scenarios.add(highLevelScenario("max-missing", null, true));
        scenarios.add(highLevelScenario("max-string-zero", "0", false));
        scenarios.add(highLevelScenario("max-string-invalid", "not-a-number", false));
        return scenarios;
    }

    private static Map<String, Object> executeScenario(Scenario scenario, String baseUrl) {
        ActiveScenario current = new ActiveScenario(scenario);
        active = current;
        Map<String, Object> capture = new LinkedHashMap<String, Object>();
        capture.put("name", scenario.name);
        capture.put("evidenceLevel", "official-captured");
        capture.put("invocationKind", scenario.invocationKind);
        capture.put("input", scenario.input);
        Map<String, Object> outcome = new LinkedHashMap<String, Object>();
        try {
            Object returned = scenario.invocation.invoke(baseUrl);
            outcome.put("type", "return");
            outcome.put("raw", returned == null ? null : returned.toString());
        } catch (Throwable error) {
            outcome.put("type", "exception");
            outcome.put("exceptionChain", exceptionChain(error));
        }
        capture.put("calls", new ArrayList<Map<String, Object>>(current.calls));
        capture.put("operationSequence", operationSequence(current.calls));
        capture.put("outcome", outcome);
        capture.put("unusedMockResponses", unusedResponses(scenario.responses));
        return capture;
    }

    private static List<String> operationSequence(List<Map<String, Object>> calls) {
        List<String> sequence = new ArrayList<String>();
        for (Map<String, Object> call : calls) sequence.add(String.valueOf(call.get("operationName")));
        return sequence;
    }

    private static Map<String, Integer> unusedResponses(Map<String, Deque<String>> responses) {
        Map<String, Integer> unused = new LinkedHashMap<String, Integer>();
        for (Map.Entry<String, Deque<String>> entry : responses.entrySet()) {
            if (!entry.getValue().isEmpty()) unused.put(entry.getKey(), entry.getValue().size());
        }
        return unused;
    }

    private static List<Map<String, String>> exceptionChain(Throwable error) {
        List<Map<String, String>> chain = new ArrayList<Map<String, String>>();
        Throwable current = error;
        for (int depth = 0; current != null && depth < 12; depth += 1) {
            Map<String, String> item = new LinkedHashMap<String, String>();
            item.put("class", current.getClass().getName());
            item.put("message", current.getMessage());
            chain.add(item);
            current = current.getCause();
        }
        return chain;
    }

    private static String resultDataString(String value) {
        return "{\"code\":10000,\"succ\":true,\"message\":\"ok\",\"data\":" + JSON.toJSONString(value) + "}";
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
        server.createContext("/normwebservice.asmx", MarketingAddStudentCapture::handle);
        server.start();
        installLoopbackOnlyNetworkGuard();
        String baseUrl = "http://127.0.0.1:" + server.getAddress().getPort();

        List<Map<String, Object>> captures = new ArrayList<Map<String, Object>>();
        try {
            for (Scenario scenario : scenarios()) captures.add(executeScenario(scenario, baseUrl));
        } finally {
            server.stop(0);
        }

        Map<String, Object> contract = new LinkedHashMap<String, Object>();
        contract.put("operationName", "AddStudent");
        contract.put("javaSignature", "String addStudent(StudentBaseClass[], String, long, long, int, boolean)");
        contract.put("parameterNames", Arrays.asList("studentList", "groupID", "st", "ed", "maxRunYear", "autoDeal"));
        contract.put("parameterTypes", Arrays.asList("ArrayOfStudentBaseClass", "string", "long", "long", "int", "boolean"));
        contract.put("soapAction", "http://tempuri.org/AddStudent");
        contract.put("returnNodeName", "AddStudentResult");

        Map<String, Object> root = new LinkedHashMap<String, Object>();
        root.put("schemaVersion", 1);
        root.put("source", "official itmc-tool-train-1.7.3.jar marketing Axis Stub against loopback-only mock SOAP");
        root.put("evidenceLevel", "official-captured");
        root.put("localhostOnly", Boolean.TRUE);
        root.put("productionTraffic", Boolean.FALSE);
        root.put("artifact", "itmc-tool-train-1.7.3.jar");
        root.put("artifactSha256", sha256(new File(args[1])));
        root.put("redactions", Arrays.asList("clientinfo.Uname", "clientinfo.Password"));
        root.put("contract", contract);
        root.put("scenarioCount", captures.size());
        root.put("scenarios", captures);

        byte[] json = JSON.toJSONString(root, true).getBytes(StandardCharsets.UTF_8);
        File outputFile = new File(args[0]);
        File parent = outputFile.getParentFile();
        if (parent != null) parent.mkdirs();
        try (FileOutputStream output = new FileOutputStream(outputFile)) {
            output.write(json);
        }
        System.out.println("CAPTURED_SCENARIOS=" + captures.size());
        System.out.println("FIXTURE=" + outputFile.getAbsolutePath());
    }
}
