import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.itmc.train.commons.constant.Global;
import com.itmc.train.newService.impl.NewTrainingInterfaceUtilService;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import entrance.TrainingEntrance;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.security.Permission;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Deque;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Local-only behavioral capture for the official NewTrainingInterfaceUtilService. */
public final class OfficialJavaPlatformCapture {
    private static volatile Active active;

    private static final class Reply {
        final int status;
        final String body;
        Reply(int status, String body) { this.status = status; this.body = body; }
    }

    private static final class Scenario {
        final String name;
        final String kind;
        final JSONObject parameters;
        final Map<String, Deque<Reply>> replies = new LinkedHashMap<String, Deque<Reply>>();
        Scenario(String name, String kind, JSONObject parameters) {
            this.name = name; this.kind = kind; this.parameters = parameters;
        }
        Scenario reply(String path, Reply... values) {
            replies.put(path, new ArrayDeque<Reply>(Arrays.asList(values)));
            return this;
        }
    }

    private static final class Active {
        final Scenario scenario;
        final List<Map<String, Object>> calls = Collections.synchronizedList(new ArrayList<Map<String, Object>>());
        Active(Scenario scenario) { this.scenario = scenario; }
    }

    private static Reply ok(String body) { return new Reply(200, body); }
    private static Reply status(int status, String body) { return new Reply(status, body); }
    private static String result(int code, boolean succ, String message, Object data) {
        JSONObject object = new JSONObject(true);
        object.put("code", code); object.put("succ", succ); object.put("message", message); object.put("data", data);
        return object.toJSONString();
    }
    private static String success(Object data) { return result(10000, true, "成功", data); }
    private static String fail(int code, String message) { return result(code, false, message, null); }

    private static JSONObject student() {
        JSONObject p = new JSONObject(true);
        p.put("loginName", "student local"); p.put("className", "班级 & A");
        p.put("teacherUserName", "teacher+one"); p.put("startTime", "1"); p.put("endTime", "2");
        p.put("flag", "train flag"); p.put("trainOrExam", "train"); p.put("userId", 1L);
        p.put("userName", "学生"); p.put("startExam", false); p.put("classType", 2);
        p.put("maxRunYear", 0); p.put("autoDeal", false); p.put("roleName", "角色/一"); p.put("teamName", "team=1");
        return p;
    }

    private static JSONObject teacher() {
        JSONObject p = new JSONObject(true);
        p.put("loginName", "teacher local"); p.put("className", "班级 & A"); p.put("userId", 1L);
        p.put("userName", "教师"); p.put("startTime", "1"); p.put("endTime", "2");
        p.put("startExam", false); p.put("classType", 3);
        p.put("studentList", new ArrayList<String>(Arrays.asList("student a", "学生+b")));
        p.put("maxRunYear", 0); p.put("autoDeal", false); p.put("roleName", "角色/一"); p.put("teamName", "team=1");
        return p;
    }

    private static Scenario studentScenario(String name) {
        return new Scenario(name, "student", student())
            .reply("/open/tokenInfo", ok(success("TOKEN-LOCAL")))
            .reply("/open/getUserName", ok(success("account-ready")))
            .reply("/open/trainingExamPaper", ok(success("ticket +%&=/中文")))
            .reply("/open/trainingExamPaperV2", ok(success("exam +%&=/中文")));
    }

    private static Scenario teacherScenario(String name) {
        return new Scenario(name, "teacher", teacher())
            .reply("/open/tokenInfo", ok(success("TOKEN-LOCAL")))
            .reply("/open/getLoginTeacherName", ok(success("teacher +%&=/中文")))
            .reply("/open/getUserName", ok(success("student-a")), ok(success("student-b")));
    }

    private static List<Scenario> scenarios() {
        List<Scenario> all = new ArrayList<Scenario>();
        all.add(new Scenario("token-success", "token", new JSONObject(true)).reply("/open/tokenInfo", ok(success("TOKEN-LOCAL"))));
        all.add(new Scenario("token-empty-response-three-attempts", "token", new JSONObject(true)).reply("/open/tokenInfo", ok(""), ok(""), ok("")));
        all.add(new Scenario("token-code-failure-three-attempts", "token", new JSONObject(true)).reply("/open/tokenInfo", ok(fail(10010, "bad")), ok(fail(10010, "bad")), ok(fail(10010, "bad"))));
        all.add(new Scenario("token-http-non-200", "token", new JSONObject(true)).reply("/open/tokenInfo", status(503, "unavailable"), status(503, "unavailable"), status(503, "unavailable")));
        all.add(new Scenario("token-data-null", "token", new JSONObject(true)).reply("/open/tokenInfo", ok(success(null))));
        all.add(new Scenario("token-data-empty", "token", new JSONObject(true)).reply("/open/tokenInfo", ok(success(""))));
        JSONObject tokenMissingData = new JSONObject(true); tokenMissingData.put("code", 10000); tokenMissingData.put("succ", true); tokenMissingData.put("message", "成功");
        all.add(new Scenario("token-data-missing", "token", new JSONObject(true)).reply("/open/tokenInfo", ok(tokenMissingData.toJSONString())));
        all.add(new Scenario("token-invalid-json", "token", new JSONObject(true)).reply("/open/tokenInfo", ok("{invalid")));
        all.add(new Scenario("token-missing-code", "token", new JSONObject(true)).reply("/open/tokenInfo", ok("{\"succ\":true,\"data\":\"TOKEN\"}")));

        all.add(studentScenario("student-train-full-parameters"));
        Scenario exam = studentScenario("student-exam-full-parameters"); exam.parameters.put("trainOrExam", "exam"); all.add(exam);
        Scenario nullFlag = studentScenario("student-null-flag"); nullFlag.parameters.put("flag", null); all.add(nullFlag);
        Scenario emptyFlag = studentScenario("student-empty-flag"); emptyFlag.parameters.put("flag", ""); all.add(emptyFlag);
        Scenario oneTime = studentScenario("student-only-start-time"); oneTime.parameters.put("endTime", null); all.add(oneTime);
        Scenario zeroTime = studentScenario("student-zero-times"); zeroTime.parameters.put("startTime", "0"); zeroTime.parameters.put("endTime", "0"); all.add(zeroTime);
        Scenario longMax = studentScenario("student-long-max-times"); longMax.parameters.put("startTime", "9223372036854775807"); longMax.parameters.put("endTime", "9223372036854775807"); all.add(longMax);
        Scenario userFail = studentScenario("student-get-user-failure"); userFail.replies.put("/open/getUserName", new ArrayDeque<Reply>(Arrays.asList(ok(fail(10010, "user%20failed"))))); all.add(userFail);
        Scenario ticketFail = studentScenario("student-ticket-10010"); ticketFail.replies.put("/open/trainingExamPaper", new ArrayDeque<Reply>(Arrays.asList(ok(fail(10010, "ticket failed"))))); all.add(ticketFail);
        Scenario retry = studentScenario("student-ticket-10011-then-success"); retry.replies.put("/open/tokenInfo", new ArrayDeque<Reply>(Arrays.asList(ok(success("TOKEN-1")), ok(success("TOKEN-2"))))); retry.replies.put("/open/getUserName", new ArrayDeque<Reply>(Arrays.asList(ok(success("ready-1")), ok(success("ready-2"))))); retry.replies.put("/open/trainingExamPaper", new ArrayDeque<Reply>(Arrays.asList(ok(fail(10011, "expired")), ok(success("ticket-2"))))); all.add(retry);
        Scenario exhausted = studentScenario("student-ticket-10011-three-times"); exhausted.replies.put("/open/tokenInfo", new ArrayDeque<Reply>(Arrays.asList(ok(success("TOKEN-1")), ok(success("TOKEN-2")), ok(success("TOKEN-3"))))); exhausted.replies.put("/open/getUserName", new ArrayDeque<Reply>(Arrays.asList(ok(success("ready-1")), ok(success("ready-2")), ok(success("ready-3"))))); exhausted.replies.put("/open/trainingExamPaper", new ArrayDeque<Reply>(Arrays.asList(ok(fail(10011, "expired")), ok(fail(10011, "expired")), ok(fail(10011, "expired"))))); all.add(exhausted);
        Scenario nullTicket = studentScenario("student-ticket-data-null"); nullTicket.replies.put("/open/trainingExamPaper", new ArrayDeque<Reply>(Arrays.asList(ok(success(null))))); all.add(nullTicket);
        Scenario emptyTicket = studentScenario("student-ticket-data-empty"); emptyTicket.replies.put("/open/trainingExamPaper", new ArrayDeque<Reply>(Arrays.asList(ok(success(""))))); all.add(emptyTicket);
        JSONObject missing = new JSONObject(true); missing.put("code", 10000); missing.put("succ", true); missing.put("message", "成功");
        Scenario missingTicket = studentScenario("student-ticket-data-missing"); missingTicket.replies.put("/open/trainingExamPaper", new ArrayDeque<Reply>(Arrays.asList(ok(missing.toJSONString())))); all.add(missingTicket);
        Scenario invalidTicket = studentScenario("student-ticket-invalid-json"); invalidTicket.replies.put("/open/trainingExamPaper", new ArrayDeque<Reply>(Arrays.asList(ok("{invalid")))); all.add(invalidTicket);

        all.add(teacherScenario("teacher-multiple-students-classmode-bug"));
        Scenario noStudents = teacherScenario("teacher-empty-student-list"); noStudents.parameters.put("studentList", new ArrayList<String>()); all.add(noStudents);
        Scenario nullStudents = teacherScenario("teacher-null-student-list"); nullStudents.parameters.put("studentList", null); all.add(nullStudents);
        Scenario duplicate = teacherScenario("teacher-duplicate-students"); duplicate.parameters.put("studentList", new ArrayList<String>(Arrays.asList("a", "a", "b"))); duplicate.replies.put("/open/getUserName", new ArrayDeque<Reply>(Arrays.asList(ok(success("a1")), ok(success("a2")), ok(success("b"))))); all.add(duplicate);
        Scenario midFail = teacherScenario("teacher-student-middle-failure"); midFail.parameters.put("studentList", new ArrayList<String>(Arrays.asList("a", "b", "c"))); midFail.replies.put("/open/getUserName", new ArrayDeque<Reply>(Arrays.asList(ok(success("a")), ok(fail(10010, "b failed")), ok(success("c"))))); all.add(midFail);
        return all;
    }

    private static void installLoopbackGuard() {
        System.setSecurityManager(new SecurityManager() {
            public void checkPermission(Permission permission) { }
            public void checkPermission(Permission permission, Object context) { }
            public void checkConnect(String host, int port) {
                if (host == null) return;
                try { if (InetAddress.getByName(host).isLoopbackAddress()) return; } catch (Exception ignored) { }
                throw new SecurityException("non-loopback network blocked: " + host + ":" + port);
            }
        });
    }

    private static String body(HttpExchange exchange) throws java.io.IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream(); byte[] buffer = new byte[4096]; int read;
        while ((read = exchange.getRequestBody().read(buffer)) >= 0) out.write(buffer, 0, read);
        return new String(out.toByteArray(), StandardCharsets.UTF_8);
    }

    private static String sanitizeToken(String token) {
        if (token == null) return null;
        if (token.startsWith("{")) {
            try {
                JSONObject parsed = JSONObject.parseObject(token);
                JSONObject redacted = new JSONObject(true);
                for (String key : parsed.keySet()) redacted.put(key, "[REDACTED]");
                return redacted.toJSONString();
            } catch (Exception ignored) { }
        }
        return "[TOKEN]";
    }

    private static void handle(HttpExchange exchange) throws java.io.IOException {
        Active current = active; String path = exchange.getRequestURI().getPath(); String requestBody = body(exchange);
        Deque<Reply> queue = current.scenario.replies.get(path); boolean fallback = queue == null || queue.isEmpty();
        Reply reply = fallback ? ok(fail(10010, "UNPLANNED")) : queue.removeFirst();
        Map<String, Object> call = new LinkedHashMap<String, Object>();
        call.put("sequence", current.calls.size() + 1); call.put("url", "http://127.0.0.1:" + exchange.getLocalAddress().getPort() + exchange.getRequestURI());
        call.put("path", path); call.put("method", exchange.getRequestMethod());
        Map<String, Object> headers = new LinkedHashMap<String, Object>();
        headers.put("Content-Type", exchange.getRequestHeaders().getFirst("Content-Type"));
        headers.put("platformToken", sanitizeToken(exchange.getRequestHeaders().getFirst("platformToken")));
        headers.put("User-Agent", exchange.getRequestHeaders().getFirst("User-Agent")); call.put("headers", headers);
        call.put("rawBody", requestBody); call.put("mockStatus", reply.status); call.put("mockRawResponse", reply.body); call.put("fallbackResponse", fallback);
        current.calls.add(call);
        byte[] bytes = reply.body.getBytes(StandardCharsets.UTF_8); exchange.getResponseHeaders().set("Content-Type", "application/json; charset=UTF-8");
        exchange.sendResponseHeaders(reply.status, bytes.length); try (OutputStream output = exchange.getResponseBody()) { output.write(bytes); }
    }

    private static Map<String, Object> exception(Throwable error) {
        List<Map<String, String>> chain = new ArrayList<Map<String, String>>(); Throwable cursor = error;
        while (cursor != null) { Map<String, String> item = new LinkedHashMap<String, String>(); item.put("class", cursor.getClass().getName()); item.put("message", cursor.getMessage()); chain.add(item); cursor = cursor.getCause(); }
        Map<String, Object> result = new LinkedHashMap<String, Object>(); result.put("kind", "exception"); result.put("exceptionChain", chain); return result;
    }

    private static Map<String, Object> returned(Object value) {
        Map<String, Object> result = new LinkedHashMap<String, Object>(); result.put("kind", "return");
        result.put("valueKind", value == null ? "null" : value.getClass().getName()); result.put("value", value); return result;
    }

    private static Object run(Scenario scenario, String baseUrl) throws Exception {
        if ("token".equals(scenario.kind)) return new NewTrainingInterfaceUtilService().getService(baseUrl).getTokenInfo();
        String method = "teacher".equals(scenario.kind) ? "commonReturnTeacherBaseInfo" : "commonReturnStudentBaseInfo";
        return new TrainingEntrance().executeNew("NewTrainingInterfaceUtilService", method, scenario.parameters, baseUrl);
    }

    public static void main(String[] args) throws Exception {
        if (args.length != 1) throw new IllegalArgumentException("fixture output path required");
        installLoopbackGuard(); HttpServer server = HttpServer.create(new InetSocketAddress(InetAddress.getByName("127.0.0.1"), 0), 0);
        server.createContext("/", OfficialJavaPlatformCapture::handle); server.start();
        String baseUrl = "http://127.0.0.1:" + server.getAddress().getPort(); List<Map<String, Object>> captured = new ArrayList<Map<String, Object>>();
        try {
            for (Scenario scenario : scenarios()) {
                Global.cache.invalidateAll(); active = new Active(scenario); Object outcome;
                try { outcome = returned(run(scenario, baseUrl)); } catch (Throwable error) { outcome = exception(error); }
                Map<String, Object> entry = new LinkedHashMap<String, Object>(); entry.put("name", scenario.name); entry.put("evidenceLevel", "official-captured");
                entry.put("parameters", scenario.parameters); entry.put("calls", active.calls); entry.put("outcome", outcome);
                boolean fallback = false; for (Map<String, Object> call : active.calls) if (Boolean.TRUE.equals(call.get("fallbackResponse"))) fallback = true;
                entry.put("fallbackResponseUsed", fallback); captured.add(entry);
            }
        } finally { server.stop(0); }
        Map<String, Object> root = new LinkedHashMap<String, Object>(); root.put("fixtureVersion", 1); root.put("evidenceLevel", "official-captured");
        root.put("networkPolicy", "127.0.0.1-only SecurityManager guard"); root.put("nonLoopbackConnections", 0); root.put("scenarios", captured);
        byte[] json = JSON.toJSONString(root, true).getBytes(StandardCharsets.UTF_8); File output = new File(args[0]); output.getParentFile().mkdirs();
        try (FileOutputStream stream = new FileOutputStream(output)) { stream.write(json); }
    }
}
