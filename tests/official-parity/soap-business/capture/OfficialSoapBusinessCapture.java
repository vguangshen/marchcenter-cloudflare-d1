import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
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
import java.util.Collections;
import java.util.Deque;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

public final class OfficialSoapBusinessCapture {
    private static final String NET = "NetGeneralStandardInterfaceUtilService";
    private static final String MARKETING = "ShichangyingxiaoshapanInterfaceUtilService";
    private static final String COMMERCE = "WangdianyunyingtuiguangGJshapanInterfaceUtilService";
    private static final Pattern TICKET_PATTERN = Pattern.compile("[0-9A-F]{16,}");
    private static volatile ActiveScenario active;

    private interface ParamCustomizer {
        void customize(JSONObject parameters);
    }

    private static final class Scenario {
        final String name;
        final String serviceName;
        final String methodName;
        final JSONObject parameters;
        final Map<String, Deque<String>> responses = new LinkedHashMap<String, Deque<String>>();

        Scenario(String name, String serviceName, String methodName, JSONObject parameters) {
            this.name = name;
            this.serviceName = serviceName;
            this.methodName = methodName;
            this.parameters = parameters;
        }

        Scenario respond(String operationName, String... rawResults) {
            responses.put(operationName, new ArrayDeque<String>(Arrays.asList(rawResults)));
            return this;
        }
    }

    private static final class ActiveScenario {
        final Scenario scenario;
        final List<Map<String, Object>> calls = Collections.synchronizedList(new ArrayList<Map<String, Object>>());

        ActiveScenario(Scenario scenario) {
            this.scenario = scenario;
        }
    }

    private static void installLoopbackOnlyNetworkGuard() {
        System.setSecurityManager(new SecurityManager() {
            @Override
            public void checkPermission(Permission permission) {
                // The capture process is otherwise unrestricted; only outbound hosts are constrained.
            }

            @Override
            public void checkPermission(Permission permission, Object context) {
                // The capture process is otherwise unrestricted; only outbound hosts are constrained.
            }

            @Override
            public void checkConnect(String host, int port) {
                if (host == null) return;
                try {
                    InetAddress address = InetAddress.getByName(host);
                    if (address.isLoopbackAddress()) return;
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

    private static String soapEnvelope(String operation, String rawResult) {
        return "<?xml version=\"1.0\" encoding=\"utf-8\"?>"
            + "<soapenv:Envelope xmlns:soapenv=\"http://schemas.xmlsoap.org/soap/envelope/\">"
            + "<soapenv:Body><" + operation + "Response xmlns=\"http://tempuri.org/\">"
            + "<" + operation + "Result>" + xmlEscape(rawResult) + "</" + operation + "Result>"
            + "</" + operation + "Response></soapenv:Body></soapenv:Envelope>";
    }

    private static String xmlEscape(String text) {
        return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;");
    }

    private static String fallbackResult(String operation) {
        if ("IsGroupExisted".equals(operation)) return resultDataString("group-fallback");
        if (operation.startsWith("Add") && operation.endsWith("Group")) return resultDataString("group-fallback");
        if ("IsStuExisted".equals(operation) || "IsTeacherExisted".equals(operation)) return resultDataString("[]");
        if ("AddStudent".equals(operation) || "AddTeacher".equals(operation)) return resultDataString("[]");
        return resultDataNull();
    }

    private static void handle(HttpExchange exchange) throws java.io.IOException {
        ActiveScenario current = active;
        String operation = operationName(exchange);
        String requestXml = readBody(exchange);
        Deque<String> queue = current.scenario.responses.get(operation);
        boolean fallback = queue == null || queue.isEmpty();
        String rawResult = fallback ? fallbackResult(operation) : queue.removeFirst();
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
        call.put("requestXml", sanitizeRequestXml(requestXml));
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

    private static JSONObject studentParameters() {
        JSONObject parameters = new JSONObject(true);
        parameters.put("loginName", "student");
        parameters.put("className", "class-local");
        parameters.put("teacherUserName", "teacher");
        parameters.put("startTime", "1");
        parameters.put("endTime", "2");
        parameters.put("flag", "1");
        parameters.put("trainOrExam", "train");
        parameters.put("userId", Long.valueOf(1L));
        parameters.put("userName", "Student Local");
        parameters.put("startExam", Boolean.FALSE);
        parameters.put("classType", Integer.valueOf(1));
        parameters.put("maxRunYear", Integer.valueOf(0));
        parameters.put("autoDeal", Boolean.FALSE);
        parameters.put("roleName", "student");
        parameters.put("teamName", "");
        return parameters;
    }

    private static JSONObject teacherParameters(List<String> studentList) {
        JSONObject parameters = new JSONObject(true);
        parameters.put("loginName", "teacher");
        parameters.put("className", "class-local");
        parameters.put("userId", Long.valueOf(1L));
        parameters.put("userName", "Teacher Local");
        parameters.put("startTime", "1");
        parameters.put("endTime", "2");
        parameters.put("startExam", Boolean.FALSE);
        parameters.put("classType", Integer.valueOf(1));
        parameters.put("studentList", new ArrayList<String>(studentList));
        parameters.put("maxRunYear", Integer.valueOf(0));
        parameters.put("autoDeal", Boolean.FALSE);
        parameters.put("roleName", "teacher");
        parameters.put("teamName", "");
        return parameters;
    }

    private static Scenario studentScenario(String name) {
        return new Scenario(name, NET, "commonReturnStudentBaseInfo", studentParameters());
    }

    private static Scenario teacherScenario(String name, List<String> students) {
        return new Scenario(name, NET, "commonReturnTeacherBaseInfo", teacherParameters(students));
    }

    private static Scenario normalStudentPlan(Scenario scenario) {
        return scenario
            .respond("IsGroupExisted", resultDataString("group-1"))
            .respond("IsStuExisted", resultDataString("[]"))
            .respond("AddStudent", resultDataString("[\"student\"]"));
    }

    private static Scenario normalTeacherPlan(Scenario scenario) {
        return scenario
            .respond("IsGroupExisted", resultDataString("group-1"))
            .respond("IsTeacherExisted", resultDataString("[\"teacher\"]"))
            .respond("IsStuExisted", resultDataString("[]"))
            .respond("AddStudent", resultDataString("[\"a\",\"b\"]"));
    }

    private static List<Scenario> scenarios() {
        List<Scenario> scenarios = new ArrayList<Scenario>();

        scenarios.add(studentScenario("group-existence-code-failure")
            .respond("IsGroupExisted", resultFailureNull("group check failed"))
            .respond("AddTrainGroup", resultDataString("group-1"))
            .respond("AddAppraisalGroup", resultDataString("group-2"))
            .respond("AddMegagameGroup", resultDataString("group-3"))
            .respond("IsStuExisted", resultDataString("[\"student\"]")));

        scenarios.add(teacherScenario("add-teacher-code-failure", Arrays.asList("a"))
            .respond("IsGroupExisted", resultDataString("group-1"))
            .respond("IsTeacherExisted", resultDataString("[]"))
            .respond("AddTeacher", resultFailureNull("teacher add failed"))
            .respond("IsStuExisted", resultDataString("[]"))
            .respond("AddStudent", resultDataString("[\"a\"]")));

        scenarios.add(normalTeacherPlan(teacherScenario("add-student-partial-success", Arrays.asList("a", "b")))
            .respond("AddStudent", resultDataString("[\"a\"]")));
        scenarios.add(normalTeacherPlan(teacherScenario("add-student-empty-success", Arrays.asList("a", "b")))
            .respond("AddStudent", resultDataString("[]")));
        scenarios.add(normalTeacherPlan(teacherScenario("add-student-null-data", Arrays.asList("a", "b")))
            .respond("AddStudent", resultDataNull()));
        scenarios.add(normalTeacherPlan(teacherScenario("add-student-missing-data", Arrays.asList("a", "b")))
            .respond("AddStudent", resultMissingData()));
        scenarios.add(normalTeacherPlan(teacherScenario("add-student-invalid-json-data", Arrays.asList("a", "b")))
            .respond("AddStudent", resultDataString("{invalid-json}")));

        addExistenceMatrix(scenarios, "IsStuExisted", false);
        addExistenceMatrix(scenarios, "IsTeacherExisted", true);
        addClassTypeMatrix(scenarios);
        addMaxRunYearMatrix(scenarios, MARKETING, "marketing");
        addMaxRunYearMatrix(scenarios, COMMERCE, "commerce");

        Scenario longMaximum = normalStudentPlan(studentScenario("java-long-maximum-wire-values"));
        longMaximum.parameters.put("userId", Long.valueOf(Long.MAX_VALUE));
        longMaximum.parameters.put("startTime", String.valueOf(Long.MAX_VALUE));
        longMaximum.parameters.put("endTime", String.valueOf(Long.MAX_VALUE));
        scenarios.add(longMaximum);

        scenarios.add(teacherScenario("duplicate-students-existing-a", Arrays.asList("a", "a", "b"))
            .respond("IsGroupExisted", resultDataString("group-1"))
            .respond("IsTeacherExisted", resultDataString("[\"teacher\"]"))
            .respond("IsStuExisted", resultDataString("[\"a\"]"))
            .respond("AddStudent", resultDataString("[\"b\"]")));
        scenarios.add(teacherScenario("duplicate-students-all-existing", Arrays.asList("a", "a", "b"))
            .respond("IsGroupExisted", resultDataString("group-1"))
            .respond("IsTeacherExisted", resultDataString("[\"teacher\"]"))
            .respond("IsStuExisted", resultDataString("[\"a\",\"b\"]"))
            .respond("AddStudent", resultDataString("[]")));

        addGroupCreationDataScenarios(scenarios);
        scenarios.add(studentScenario("group-creation-object-used-by-add-student")
            .respond("IsGroupExisted", resultDataNull())
            .respond("AddTrainGroup", resultDataObject("{\"id\":\"group-object\"}"))
            .respond("IsStuExisted", resultDataString("[]"))
            .respond("AddStudent", resultDataString("[\"student\"]")));
        return scenarios;
    }

    private static void addExistenceMatrix(List<Scenario> scenarios, String operation, boolean teacher) {
        String prefix = operation.equals("IsStuExisted") ? "stu-existence-" : "teacher-existence-";
        List<String[]> cases = Arrays.asList(
            new String[]{"code-failure", resultFailureNull("existence failed")},
            new String[]{"null-data", resultDataNull()},
            new String[]{"empty-data", resultDataString("")},
            new String[]{"missing-data", resultMissingData()},
            new String[]{"single-string", resultDataString("single")},
            new String[]{"object-data", resultDataObject("{\"id\":\"x\"}")},
            new String[]{"non-string-array", resultDataArray("[1,{\"x\":2}]")}
        );
        for (String[] item : cases) {
            Scenario scenario = teacher
                ? teacherScenario(prefix + item[0], Collections.<String>emptyList())
                : studentScenario(prefix + item[0]);
            scenario.respond("IsGroupExisted", resultDataString("group-1"));
            scenario.respond(operation, item[1]);
            scenario.respond("AddTeacher", resultDataString("[\"teacher\"]"));
            scenario.respond("AddStudent", resultDataString("[\"student\"]"));
            scenarios.add(scenario);
        }
    }

    private static void addClassTypeMatrix(List<Scenario> scenarios) {
        Object[][] cases = new Object[][]{
            {"null", null, Boolean.FALSE},
            {"zero", Integer.valueOf(0), Boolean.FALSE},
            {"one", Integer.valueOf(1), Boolean.FALSE},
            {"two", Integer.valueOf(2), Boolean.FALSE},
            {"three", Integer.valueOf(3), Boolean.FALSE},
            {"four", Integer.valueOf(4), Boolean.FALSE},
            {"string-one", "1", Boolean.FALSE},
            {"string-two", "2", Boolean.FALSE},
            {"string-three", "3", Boolean.FALSE},
            {"string-invalid", "not-a-number", Boolean.FALSE},
            {"missing", null, Boolean.TRUE}
        };
        for (Object[] item : cases) {
            Scenario scenario = studentScenario("class-type-" + item[0]);
            if (((Boolean)item[2]).booleanValue()) scenario.parameters.remove("classType");
            else scenario.parameters.put("classType", item[1]);
            scenario
                .respond("IsGroupExisted", resultDataNull())
                .respond("AddTrainGroup", resultDataString("group-train"))
                .respond("AddAppraisalGroup", resultDataString("group-appraisal"))
                .respond("AddMegagameGroup", resultDataString("group-megagame"))
                .respond("IsStuExisted", resultDataString("[\"student\"]"));
            scenarios.add(scenario);
        }
    }

    private static void addMaxRunYearMatrix(List<Scenario> scenarios, String serviceName, String prefix) {
        Object[][] cases = new Object[][]{
            {"null", null, Boolean.FALSE},
            {"missing", null, Boolean.TRUE},
            {"zero", Integer.valueOf(0), Boolean.FALSE},
            {"string-zero", "0", Boolean.FALSE},
            {"ten", Integer.valueOf(10), Boolean.FALSE},
            {"string-invalid", "not-a-number", Boolean.FALSE}
        };
        for (Object[] item : cases) {
            Scenario scenario = new Scenario(
                prefix + "-max-run-year-" + item[0],
                serviceName,
                "commonReturnStudentBaseInfo",
                studentParameters()
            );
            if (((Boolean)item[2]).booleanValue()) scenario.parameters.remove("maxRunYear");
            else scenario.parameters.put("maxRunYear", item[1]);
            scenario
                .respond("IsGroupExisted", resultDataString("group-1"))
                .respond("IsStuExisted", resultDataString("[]"))
                .respond("AddStudent", resultDataString("[\"student\"]"));
            scenarios.add(scenario);
        }
    }

    private static void addGroupCreationDataScenarios(List<Scenario> scenarios) {
        String[][] cases = new String[][]{
            {"null", resultDataNull()},
            {"empty", resultDataString("")},
            {"missing", resultMissingData()},
            {"object", resultDataObject("{\"id\":\"group-object\"}")}
        };
        for (String[] item : cases) {
            Scenario scenario = studentScenario("group-creation-data-" + item[0])
                .respond("IsGroupExisted", resultDataNull())
                .respond("AddTrainGroup", item[1])
                .respond("IsStuExisted", resultDataString("[\"student\"]"));
            scenarios.add(scenario);
        }
    }

    private static Map<String, Object> executeScenario(Scenario scenario, String baseUrl) {
        ActiveScenario current = new ActiveScenario(scenario);
        active = current;
        Map<String, Object> capture = new LinkedHashMap<String, Object>();
        capture.put("name", scenario.name);
        capture.put("evidenceLevel", "official-captured");
        capture.put("serviceName", scenario.serviceName);
        capture.put("methodName", scenario.methodName);
        capture.put("parameters", JSON.parseObject(scenario.parameters.toJSONString(), LinkedHashMap.class));
        Map<String, Object> outcome = new LinkedHashMap<String, Object>();
        try {
            Object returned = new TrainingEntrance().executeNew(
                scenario.serviceName,
                scenario.methodName,
                scenario.parameters,
                baseUrl
            );
            String raw = returned == null ? null : returned.toString();
            outcome.put("type", "return");
            outcome.put("raw", raw);
            outcome.put("ticketGenerated", raw != null && TICKET_PATTERN.matcher(raw).find());
        } catch (Throwable error) {
            outcome.put("type", "exception");
            outcome.put("exceptionChain", exceptionChain(error));
            outcome.put("ticketGenerated", Boolean.FALSE);
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

    private static String resultDataNull() {
        return "{\"code\":10000,\"succ\":true,\"message\":\"ok\",\"data\":null}";
    }

    private static String resultMissingData() {
        return "{\"code\":10000,\"succ\":true,\"message\":\"ok\"}";
    }

    private static String resultFailureNull(String message) {
        return "{\"code\":10010,\"succ\":false,\"message\":" + JSON.toJSONString(message) + ",\"data\":null}";
    }

    private static String resultDataString(String value) {
        return "{\"code\":10000,\"succ\":true,\"message\":\"ok\",\"data\":" + JSON.toJSONString(value) + "}";
    }

    private static String resultDataObject(String objectJson) {
        return "{\"code\":10000,\"succ\":true,\"message\":\"ok\",\"data\":" + objectJson + "}";
    }

    private static String resultDataArray(String arrayJson) {
        return "{\"code\":10000,\"succ\":true,\"message\":\"ok\",\"data\":" + arrayJson + "}";
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
        server.createContext("/normwebservice.asmx", OfficialSoapBusinessCapture::handle);
        server.start();
        installLoopbackOnlyNetworkGuard();
        String baseUrl = "http://127.0.0.1:" + server.getAddress().getPort();

        List<Map<String, Object>> captures = new ArrayList<Map<String, Object>>();
        try {
            for (Scenario scenario : scenarios()) captures.add(executeScenario(scenario, baseUrl));
        } finally {
            server.stop(0);
        }

        Map<String, Object> root = new LinkedHashMap<String, Object>();
        root.put("schemaVersion", 1);
        root.put("source", "official itmc-tool-train-1.7.3.jar against loopback-only mock SOAP");
        root.put("evidenceLevel", "official-captured");
        root.put("localhostOnly", Boolean.TRUE);
        root.put("productionTraffic", Boolean.FALSE);
        root.put("artifact", "itmc-tool-train-1.7.3.jar");
        root.put("artifactSha256", sha256(new File(args[1])));
        root.put("redactions", Arrays.asList("clientinfo.Uname", "clientinfo.Password"));
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
