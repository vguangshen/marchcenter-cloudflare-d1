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
import java.math.BigDecimal;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.URL;
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
 * Local-only golden capture for the three profiles that were previously derived
 * from static WSDL analysis only:
 *   - managementAccounting   (GuanlikuaijiGJshapanInterfaceUtilService)
 *   - crossBorderCommerce    (KuajingdianshangshapanInterfaceUtilService)
 *   - enterpriseManagement   (QiyeguanlishapanInterfaceUtilService)
 *
 * Runs the official Axis stubs from itmc-tool-train-1.7.3.jar against a
 * loopback-only mock SOAP endpoint and records byte-for-byte request XML.
 * Run with the official JAR plus the Virbox agent:
 *   java -javaagent:agent.jar -cp "<out>;<WEB-INF lib>" StaticDerivedProfilesCapture <fixtureDir> <officialJarPath>
 */
public final class StaticDerivedProfilesCapture {
    private static final String MANAGEMENT_ACCOUNTING = "GuanlikuaijiGJshapanInterfaceUtilService";
    private static final String CROSS_BORDER_COMMERCE = "KuajingdianshangshapanInterfaceUtilService";
    private static final String ENTERPRISE_MANAGEMENT = "QiyeguanlishapanInterfaceUtilService";

    private static volatile Active active;

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
        Active current = active;
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

    private static String resultDataString(String value) {
        return "{\"code\":10000,\"succ\":true,\"message\":\"ok\",\"data\":" + JSON.toJSONString(value) + "}";
    }

    private static Map<String, Object> inputOf(Object... pairs) {
        Map<String, Object> input = new LinkedHashMap<String, Object>();
        for (int index = 0; index + 1 < pairs.length; index += 2) input.put(String.valueOf(pairs[index]), pairs[index + 1]);
        return input;
    }

    private static List<Map<String, Object>> studentValues(List<Map<String, String>> students) {
        List<Map<String, Object>> values = new ArrayList<Map<String, Object>>();
        for (Map<String, String> student : students) {
            Map<String, Object> item = new LinkedHashMap<String, Object>();
            item.put("studentID", student.get("studentID"));
            item.put("password", student.get("password"));
            item.put("nickName", student.get("nickName"));
            values.add(item);
        }
        return values;
    }

    private static List<Map<String, String>> singleStudent(String id, String password, String nickName) {
        Map<String, String> student = new LinkedHashMap<String, String>();
        student.put("studentID", id);
        student.put("password", password);
        student.put("nickName", nickName);
        return Arrays.asList(student);
    }

    // ---------------------------------------------------------------- managementAccounting
    private static List<Scenario> managementScenarios() {
        final String service = MANAGEMENT_ACCOUNTING;
        List<Scenario> list = new ArrayList<Scenario>();
        list.add(direct(service, "is-group-existed", "IsGroupExisted", inputOf("groupName", "class-local", "groupID", ""), new Invocation() {
            public Object invoke(String baseUrl) throws Throwable {
                return new com.itmc.train.newService.impl.GuanlikuaijiGJshapanInterfaceUtilService()
                    .getService(baseUrl).isGroupExisted("class-local", "");
            }
        }, "\"group-1\""));
        list.add(direct(service, "add-train-group", "AddTrainGroup", inputOf("groupName", "class-local"), new Invocation() {
            public Object invoke(String baseUrl) throws Throwable {
                return new com.itmc.train.newService.impl.GuanlikuaijiGJshapanInterfaceUtilService()
                    .getService(baseUrl).addTrainGroup("class-local");
            }
        }, "\"group-1\""));
        list.add(direct(service, "add-appraisal-group", "AddAppraisalGroup", inputOf("groupName", "class-local"), new Invocation() {
            public Object invoke(String baseUrl) throws Throwable {
                return new com.itmc.train.newService.impl.GuanlikuaijiGJshapanInterfaceUtilService()
                    .getService(baseUrl).addAppraisalGroup("class-local");
            }
        }, "\"group-1\""));
        list.add(direct(service, "add-megagame-group", "AddMegagameGroup", inputOf("groupName", "class-local"), new Invocation() {
            public Object invoke(String baseUrl) throws Throwable {
                return new com.itmc.train.newService.impl.GuanlikuaijiGJshapanInterfaceUtilService()
                    .getService(baseUrl).addMegagameGroup("class-local");
            }
        }, "\"group-1\""));
        list.add(direct(service, "is-stu-existed", "IsStuExisted", inputOf("accountList", new String[]{"student"}), new Invocation() {
            public Object invoke(String baseUrl) throws Throwable {
                return new com.itmc.train.newService.impl.GuanlikuaijiGJshapanInterfaceUtilService()
                    .getService(baseUrl).isStuExisted(new String[]{"student"});
            }
        }, "[]"));
        list.add(direct(service, "is-teacher-existed", "IsTeacherExisted", inputOf("accountList", new String[]{"teacher"}), new Invocation() {
            public Object invoke(String baseUrl) throws Throwable {
                return new com.itmc.train.newService.impl.GuanlikuaijiGJshapanInterfaceUtilService()
                    .getService(baseUrl).isTeacherExisted(new String[]{"teacher"});
            }
        }, "[]"));
        list.add(direct(service, "add-teacher", "AddTeacher", inputOf("groupID", "group-1", "teacherNameList", new String[]{"teacher"}), new Invocation() {
            public Object invoke(String baseUrl) throws Throwable {
                return new com.itmc.train.newService.impl.GuanlikuaijiGJshapanInterfaceUtilService()
                    .getService(baseUrl).addTeacher("group-1", new String[]{"teacher"});
            }
        }, "[\"teacher\"]"));
        addStudentSix(list, service, "add-student-max-zero-auto-false", 0, false, 1L, 2L, "student-1", "pw", "Student One");
        addStudentSix(list, service, "add-student-max-ten-auto-true", 10, true, 11L, 22L, "student-1", "pw", "Student One");
        addStudentSix(list, service, "add-student-long-maximum", 10, true, Long.MAX_VALUE, Long.MAX_VALUE, "student-1", "pw", "Student One");
        list.add(direct(service, "add-student-multiple", "AddStudent", inputOf(
            "studentList", studentValues(Arrays.asList(
                singleStudent("student-a", "p-a", "Student A").get(0),
                singleStudent("student-b", "p-b", "Student B").get(0))),
            "groupID", "group-1", "st", "1", "ed", "2", "maxRunYear", 0, "autoDeal", false
        ), new Invocation() {
            public Object invoke(String baseUrl) throws Throwable {
                com.itmc.train.webservice.shapan_guanlikuaijigaoji.StudentBaseClass[] students = new com.itmc.train.webservice.shapan_guanlikuaijigaoji.StudentBaseClass[]{
                    new com.itmc.train.webservice.shapan_guanlikuaijigaoji.StudentBaseClass("student-a", "p-a", "Student A"),
                    new com.itmc.train.webservice.shapan_guanlikuaijigaoji.StudentBaseClass("student-b", "p-b", "Student B")
                };
                return new com.itmc.train.newService.impl.GuanlikuaijiGJshapanInterfaceUtilService()
                    .getService(baseUrl).addStudent(students, "group-1", 1L, 2L, 0, false);
            }
        }, "[\"student-a\",\"student-b\"]"));
        list.add(direct(service, "add-student-null-optional", "AddStudent", inputOf(
            "studentList", studentValues(Arrays.asList(singleStudent("student-null", null, null).get(0))),
            "groupID", "group-1", "st", "1", "ed", "2", "maxRunYear", 0, "autoDeal", false
        ), new Invocation() {
            public Object invoke(String baseUrl) throws Throwable {
                com.itmc.train.webservice.shapan_guanlikuaijigaoji.StudentBaseClass[] students = new com.itmc.train.webservice.shapan_guanlikuaijigaoji.StudentBaseClass[]{
                    new com.itmc.train.webservice.shapan_guanlikuaijigaoji.StudentBaseClass("student-null", null, null)
                };
                return new com.itmc.train.newService.impl.GuanlikuaijiGJshapanInterfaceUtilService()
                    .getService(baseUrl).addStudent(students, "group-1", 1L, 2L, 0, false);
            }
        }, "[\"student-null\"]"));
        list.add(direct(service, "add-student-xml-special", "AddStudent", inputOf(
            "studentList", studentValues(Arrays.asList(singleStudent("学生&<一>\"'", "密码&<>\"'", "姓名中文&<>\"'").get(0))),
            "groupID", "班级&<>\"'", "st", "1", "ed", "2", "maxRunYear", 0, "autoDeal", false
        ), new Invocation() {
            public Object invoke(String baseUrl) throws Throwable {
                com.itmc.train.webservice.shapan_guanlikuaijigaoji.StudentBaseClass[] students = new com.itmc.train.webservice.shapan_guanlikuaijigaoji.StudentBaseClass[]{
                    new com.itmc.train.webservice.shapan_guanlikuaijigaoji.StudentBaseClass("学生&<一>\"'", "密码&<>\"'", "姓名中文&<>\"'")
                };
                return new com.itmc.train.newService.impl.GuanlikuaijiGJshapanInterfaceUtilService()
                    .getService(baseUrl).addStudent(students, "班级&<>\"'", 1L, 2L, 0, false);
            }
        }, "[\"student-1\"]"));
        list.add(direct(service, "get-stu-train-score", "GetStuTrainScore", inputOf(
            "type", 1, "groupID", "group-1", "studentIDList", new String[]{"student"}, "isMaxRunYear", true
        ), new Invocation() {
            public Object invoke(String baseUrl) throws Throwable {
                return new com.itmc.train.newService.impl.GuanlikuaijiGJshapanInterfaceUtilService()
                    .getService(baseUrl).getStuTrainScore(1, "group-1", new String[]{"student"}, true);
            }
        }, "[{\"nScore\":88}]"));
        list.add(direct(service, "get-stu-theory-score", "GetStuTheoryScore", inputOf("studentIDList", new String[]{"student"}), new Invocation() {
            public Object invoke(String baseUrl) throws Throwable {
                return new com.itmc.train.newService.impl.GuanlikuaijiGJshapanInterfaceUtilService()
                    .getService(baseUrl).getStuTheoryScore(new String[]{"student"});
            }
        }, "[{\"Score\":90}]"));
        list.add(direct(service, "reset-stu-end-time", "ResetStuEndTime", inputOf("studentID", "student", "endTime", "9223372036854775807"), new Invocation() {
            public Object invoke(String baseUrl) throws Throwable {
                return new com.itmc.train.newService.impl.GuanlikuaijiGJshapanInterfaceUtilService()
                    .getService(baseUrl).resetStuEndTime("student", Long.MAX_VALUE);
            }
        }, "\"ok\""));
        list.add(direct(service, "mark-stu-deleted", "MarkStuDeleted", inputOf("studentIDList", new String[]{"student"}), new Invocation() {
            public Object invoke(String baseUrl) throws Throwable {
                return new com.itmc.train.newService.impl.GuanlikuaijiGJshapanInterfaceUtilService()
                    .getService(baseUrl).markStuDeleted(new String[]{"student"});
            }
        }, "\"ok\""));
        list.add(direct(service, "del-student", "DelStudent", inputOf("studentIDList", new String[]{"student"}), new Invocation() {
            public Object invoke(String baseUrl) throws Throwable {
                return new com.itmc.train.newService.impl.GuanlikuaijiGJshapanInterfaceUtilService()
                    .getService(baseUrl).delStudent(new String[]{"student"});
            }
        }, "\"ok\""));
        list.add(direct(service, "get-system-info", "GetSystemInfo", inputOf(), new Invocation() {
            public Object invoke(String baseUrl) throws Throwable {
                return new com.itmc.train.newService.impl.GuanlikuaijiGJshapanInterfaceUtilService()
                    .getService(baseUrl).getSystemInfo();
            }
        }, "{\"OnlineUserCount\":\"3\"}"));
        list.add(direct(service, "get-run-state", "GetRunState", inputOf("groupID", "group-1"), new Invocation() {
            public Object invoke(String baseUrl) throws Throwable {
                return new com.itmc.train.newService.impl.GuanlikuaijiGJshapanInterfaceUtilService()
                    .getService(baseUrl).getRunState("group-1");
            }
        }, "\"running\""));
        list.add(trainingScenario(service, "training-entrance-student-classType1", 1, "AddTrainGroup"));
        list.add(trainingScenario(service, "training-entrance-student-classType3", 3, "AddMegagameGroup"));
        return list;
    }

    private static Scenario addStudentSix(List<Scenario> list, final String service, final String name,
                                          final int maxRunYear, final boolean autoDeal,
                                          final long st, final long ed, final String id, final String pw, final String nick) {
        Scenario scenario = direct(service, name, "AddStudent", inputOf(
            "studentList", studentValues(Arrays.asList(singleStudent(id, pw, nick).get(0))),
            "groupID", "group-1", "st", String.valueOf(st), "ed", String.valueOf(ed),
            "maxRunYear", maxRunYear, "autoDeal", autoDeal
        ), new Invocation() {
            public Object invoke(String baseUrl) throws Throwable {
                com.itmc.train.webservice.shapan_guanlikuaijigaoji.StudentBaseClass[] students = new com.itmc.train.webservice.shapan_guanlikuaijigaoji.StudentBaseClass[]{
                    new com.itmc.train.webservice.shapan_guanlikuaijigaoji.StudentBaseClass(id, pw, nick)
                };
                return new com.itmc.train.newService.impl.GuanlikuaijiGJshapanInterfaceUtilService()
                    .getService(baseUrl).addStudent(students, "group-1", st, ed, maxRunYear, autoDeal);
            }
        }, "[\"" + id + "\"]");
        list.add(scenario);
        return scenario;
    }

    // ---------------------------------------------------------------- crossBorderCommerce
    private static List<Scenario> crossBorderScenarios() {
        final String service = CROSS_BORDER_COMMERCE;
        List<Scenario> list = new ArrayList<Scenario>();
        list.add(direct(service, "is-group-existed", "IsGroupExisted", inputOf("groupName", "class-local", "groupID", ""), new Invocation() {
            public Object invoke(String baseUrl) throws Throwable {
                return new com.itmc.train.newService.impl.KuajingdianshangshapanInterfaceUtilService()
                    .getService(baseUrl).isGroupExisted("class-local", "");
            }
        }, "\"group-1\""));
        list.add(direct(service, "add-group", "AddGroup", inputOf("groupName", "class-local"), new Invocation() {
            public Object invoke(String baseUrl) throws Throwable {
                return new com.itmc.train.newService.impl.KuajingdianshangshapanInterfaceUtilService()
                    .getService(baseUrl).addGroup("class-local");
            }
        }, "\"group-1\""));
        list.add(direct(service, "add-megagame-group", "AddMegagameGroup", inputOf("groupName", "class-local"), new Invocation() {
            public Object invoke(String baseUrl) throws Throwable {
                return new com.itmc.train.newService.impl.KuajingdianshangshapanInterfaceUtilService()
                    .getService(baseUrl).addMegagameGroup("class-local");
            }
        }, "\"group-1\""));
        list.add(direct(service, "is-stu-existed", "IsStuExisted", inputOf("accountList", new String[]{"student"}), new Invocation() {
            public Object invoke(String baseUrl) throws Throwable {
                return new com.itmc.train.newService.impl.KuajingdianshangshapanInterfaceUtilService()
                    .getService(baseUrl).isStuExisted(new String[]{"student"});
            }
        }, "[]"));
        list.add(direct(service, "is-teacher-existed", "IsTeacherExisted", inputOf("accountList", new String[]{"teacher"}), new Invocation() {
            public Object invoke(String baseUrl) throws Throwable {
                return new com.itmc.train.newService.impl.KuajingdianshangshapanInterfaceUtilService()
                    .getService(baseUrl).isTeacherExisted(new String[]{"teacher"});
            }
        }, "[]"));
        list.add(direct(service, "add-teacher", "AddTeacher", inputOf("groupID", "group-1", "teacherNameList", new String[]{"teacher"}), new Invocation() {
            public Object invoke(String baseUrl) throws Throwable {
                return new com.itmc.train.newService.impl.KuajingdianshangshapanInterfaceUtilService()
                    .getService(baseUrl).addTeacher("group-1", new String[]{"teacher"});
            }
        }, "[\"teacher\"]"));
        addStudentFive(list, service, "add-student-start-exam-false", false, 1L, 2L, "student-1", "pw", "Student One");
        addStudentFive(list, service, "add-student-start-exam-true", true, 11L, 22L, "student-1", "pw", "Student One");
        addStudentFive(list, service, "add-student-long-maximum", true, Long.MAX_VALUE, Long.MAX_VALUE, "student-1", "pw", "Student One");
        list.add(direct(service, "add-student-multiple", "AddStudent", inputOf(
            "studentList", studentValues(Arrays.asList(
                singleStudent("student-a", "p-a", "Student A").get(0),
                singleStudent("student-b", "p-b", "Student B").get(0))),
            "groupID", "group-1", "st", "1", "ed", "2", "startExam", false
        ), new Invocation() {
            public Object invoke(String baseUrl) throws Throwable {
                com.itmc.train.webservice.shapan_kuajingdianshang.StudentBaseClass[] students = new com.itmc.train.webservice.shapan_kuajingdianshang.StudentBaseClass[]{
                    new com.itmc.train.webservice.shapan_kuajingdianshang.StudentBaseClass("student-a", "p-a", "Student A"),
                    new com.itmc.train.webservice.shapan_kuajingdianshang.StudentBaseClass("student-b", "p-b", "Student B")
                };
                return new com.itmc.train.newService.impl.KuajingdianshangshapanInterfaceUtilService()
                    .getService(baseUrl).addStudent(students, "group-1", 1L, 2L, false);
            }
        }, "[\"student-a\",\"student-b\"]"));
        list.add(direct(service, "add-student-null-optional", "AddStudent", inputOf(
            "studentList", studentValues(Arrays.asList(singleStudent("student-null", null, null).get(0))),
            "groupID", "group-1", "st", "1", "ed", "2", "startExam", false
        ), new Invocation() {
            public Object invoke(String baseUrl) throws Throwable {
                com.itmc.train.webservice.shapan_kuajingdianshang.StudentBaseClass[] students = new com.itmc.train.webservice.shapan_kuajingdianshang.StudentBaseClass[]{
                    new com.itmc.train.webservice.shapan_kuajingdianshang.StudentBaseClass("student-null", null, null)
                };
                return new com.itmc.train.newService.impl.KuajingdianshangshapanInterfaceUtilService()
                    .getService(baseUrl).addStudent(students, "group-1", 1L, 2L, false);
            }
        }, "[\"student-null\"]"));
        list.add(direct(service, "add-student-xml-special", "AddStudent", inputOf(
            "studentList", studentValues(Arrays.asList(singleStudent("学生&<一>\"'", "密码&<>\"'", "姓名中文&<>\"'").get(0))),
            "groupID", "班级&<>\"'", "st", "1", "ed", "2", "startExam", false
        ), new Invocation() {
            public Object invoke(String baseUrl) throws Throwable {
                com.itmc.train.webservice.shapan_kuajingdianshang.StudentBaseClass[] students = new com.itmc.train.webservice.shapan_kuajingdianshang.StudentBaseClass[]{
                    new com.itmc.train.webservice.shapan_kuajingdianshang.StudentBaseClass("学生&<一>\"'", "密码&<>\"'", "姓名中文&<>\"'")
                };
                return new com.itmc.train.newService.impl.KuajingdianshangshapanInterfaceUtilService()
                    .getService(baseUrl).addStudent(students, "班级&<>\"'", 1L, 2L, false);
            }
        }, "[\"student-1\"]"));
        list.add(direct(service, "get-stu-basedata", "GetStuBasedata", inputOf("groupID", "group-1"), new Invocation() {
            public Object invoke(String baseUrl) throws Throwable {
                return new com.itmc.train.newService.impl.KuajingdianshangshapanInterfaceUtilService()
                    .getService(baseUrl).getStuBasedata("group-1");
            }
        }, "[{\"StudentID\":\"student\"}]"));
        list.add(direct(service, "compute-stu-final-score", "ComputeStuFinalScore", inputOf(
            "basedataList", Arrays.asList(inputOf(
                "studentID", "student-1", "SYZQY", "1234.56", "currYear", 2026, "currQuarter", 2,
                "currStepCode", "S3", "userStepScore", "88.5", "score", "90"))
        ), new Invocation() {
            public Object invoke(String baseUrl) throws Throwable {
                com.itmc.train.webservice.shapan_kuajingdianshang.StuBaseDataClass base = new com.itmc.train.webservice.shapan_kuajingdianshang.StuBaseDataClass();
                base.setStudentID("student-1");
                base.setSYZQY(new BigDecimal("1234.56"));
                base.setCurrYear(2026);
                base.setCurrQuarter(2);
                base.setCurrStepCode("S3");
                base.setUserStepScore(new BigDecimal("88.5"));
                base.setScore(new BigDecimal("90"));
                return new com.itmc.train.newService.impl.KuajingdianshangshapanInterfaceUtilService()
                    .getService(baseUrl).computeStuFinalScore(new com.itmc.train.webservice.shapan_kuajingdianshang.StuBaseDataClass[]{base});
            }
        }, "[{\"Score\":90}]"));
        list.add(direct(service, "get-stu-train-score", "GetStuTrainScore", inputOf("studentIDList", new String[]{"student"}), new Invocation() {
            public Object invoke(String baseUrl) throws Throwable {
                return new com.itmc.train.newService.impl.KuajingdianshangshapanInterfaceUtilService()
                    .getService(baseUrl).getStuTrainScore(new String[]{"student"});
            }
        }, "[{\"Score\":88}]"));
        list.add(direct(service, "start-exam", "StartExam", inputOf("groupID", "group-1", "st", "1", "ed", "2"), new Invocation() {
            public Object invoke(String baseUrl) throws Throwable {
                return new com.itmc.train.newService.impl.KuajingdianshangshapanInterfaceUtilService()
                    .getService(baseUrl).startExam("group-1", 1L, 2L);
            }
        }, "\"ok\""));
        list.add(direct(service, "get-exam-state", "GetExamState", inputOf("groupIDList", new String[]{"group-1"}), new Invocation() {
            public Object invoke(String baseUrl) throws Throwable {
                return new com.itmc.train.newService.impl.KuajingdianshangshapanInterfaceUtilService()
                    .getService(baseUrl).getExamState(new String[]{"group-1"});
            }
        }, "\"running\""));
        list.add(direct(service, "mark-stu-deleted", "MarkStuDeleted", inputOf("studentIDList", new String[]{"student"}), new Invocation() {
            public Object invoke(String baseUrl) throws Throwable {
                return new com.itmc.train.newService.impl.KuajingdianshangshapanInterfaceUtilService()
                    .getService(baseUrl).markStuDeleted(new String[]{"student"});
            }
        }, "\"ok\""));
        list.add(direct(service, "del-student", "DelStudent", inputOf("studentIDList", new String[]{"student"}), new Invocation() {
            public Object invoke(String baseUrl) throws Throwable {
                return new com.itmc.train.newService.impl.KuajingdianshangshapanInterfaceUtilService()
                    .getService(baseUrl).delStudent(new String[]{"student"});
            }
        }, "\"ok\""));
        list.add(direct(service, "get-system-info", "GetSystemInfo", inputOf(), new Invocation() {
            public Object invoke(String baseUrl) throws Throwable {
                return new com.itmc.train.newService.impl.KuajingdianshangshapanInterfaceUtilService()
                    .getService(baseUrl).getSystemInfo();
            }
        }, "{\"OnlineUserCount\":\"3\"}"));
        list.add(trainingScenario(service, "training-entrance-student-classType1", 1, "AddGroup"));
        list.add(trainingScenario(service, "training-entrance-student-classType3", 3, "AddMegagameGroup"));
        return list;
    }

    private static Scenario addStudentFive(List<Scenario> list, final String service, final String name,
                                           final boolean startExam, final long st, final long ed,
                                           final String id, final String pw, final String nick) {
        Scenario scenario = direct(service, name, "AddStudent", inputOf(
            "studentList", studentValues(Arrays.asList(singleStudent(id, pw, nick).get(0))),
            "groupID", "group-1", "st", String.valueOf(st), "ed", String.valueOf(ed), "startExam", startExam
        ), new Invocation() {
            public Object invoke(String baseUrl) throws Throwable {
                com.itmc.train.webservice.shapan_kuajingdianshang.StudentBaseClass[] students = new com.itmc.train.webservice.shapan_kuajingdianshang.StudentBaseClass[]{
                    new com.itmc.train.webservice.shapan_kuajingdianshang.StudentBaseClass(id, pw, nick)
                };
                return new com.itmc.train.newService.impl.KuajingdianshangshapanInterfaceUtilService()
                    .getService(baseUrl).addStudent(students, "group-1", st, ed, startExam);
            }
        }, "[\"" + id + "\"]");
        list.add(scenario);
        return scenario;
    }

    // ---------------------------------------------------------------- enterpriseManagement
    private static List<Scenario> enterpriseScenarios() {
        final String service = ENTERPRISE_MANAGEMENT;
        List<Scenario> list = new ArrayList<Scenario>();
        list.add(direct(service, "is-group-existed", "IsGroupExisted", inputOf("groupName", "class-local", "groupID", ""), new Invocation() {
            public Object invoke(String baseUrl) throws Throwable {
                return new com.itmc.train.newService.impl.QiyeguanlishapanInterfaceUtilService()
                    .getService(baseUrl).isGroupExisted("class-local", "");
            }
        }, "\"group-1\""));
        list.add(direct(service, "add-train-group", "AddTrainGroup", inputOf("groupName", "class-local"), new Invocation() {
            public Object invoke(String baseUrl) throws Throwable {
                return new com.itmc.train.newService.impl.QiyeguanlishapanInterfaceUtilService()
                    .getService(baseUrl).addTrainGroup("class-local");
            }
        }, "\"group-1\""));
        list.add(direct(service, "add-appraisal-group", "AddAppraisalGroup", inputOf("groupName", "class-local"), new Invocation() {
            public Object invoke(String baseUrl) throws Throwable {
                return new com.itmc.train.newService.impl.QiyeguanlishapanInterfaceUtilService()
                    .getService(baseUrl).addAppraisalGroup("class-local");
            }
        }, "\"group-1\""));
        list.add(direct(service, "add-megagame-group", "AddMegagameGroup", inputOf("groupName", "class-local"), new Invocation() {
            public Object invoke(String baseUrl) throws Throwable {
                return new com.itmc.train.newService.impl.QiyeguanlishapanInterfaceUtilService()
                    .getService(baseUrl).addMegagameGroup("class-local");
            }
        }, "\"group-1\""));
        list.add(direct(service, "is-stu-existed", "IsStuExisted", inputOf("accountList", new String[]{"student"}), new Invocation() {
            public Object invoke(String baseUrl) throws Throwable {
                return new com.itmc.train.newService.impl.QiyeguanlishapanInterfaceUtilService()
                    .getService(baseUrl).isStuExisted(new String[]{"student"});
            }
        }, "[]"));
        list.add(direct(service, "is-teacher-existed", "IsTeacherExisted", inputOf("accountList", new String[]{"teacher"}), new Invocation() {
            public Object invoke(String baseUrl) throws Throwable {
                return new com.itmc.train.newService.impl.QiyeguanlishapanInterfaceUtilService()
                    .getService(baseUrl).isTeacherExisted(new String[]{"teacher"});
            }
        }, "[]"));
        list.add(direct(service, "add-teacher", "AddTeacher", inputOf("groupID", "group-1", "teacherNameList", new String[]{"teacher"}), new Invocation() {
            public Object invoke(String baseUrl) throws Throwable {
                return new com.itmc.train.newService.impl.QiyeguanlishapanInterfaceUtilService()
                    .getService(baseUrl).addTeacher("group-1", new String[]{"teacher"});
            }
        }, "[\"teacher\"]"));
        addStudentSix(list, service, "add-student-max-zero-auto-false", 0, false, 1L, 2L, "student-1", "pw", "Student One");
        addStudentSix(list, service, "add-student-max-ten-auto-true", 10, true, 11L, 22L, "student-1", "pw", "Student One");
        addStudentSix(list, service, "add-student-long-maximum", 10, true, Long.MAX_VALUE, Long.MAX_VALUE, "student-1", "pw", "Student One");
        list.add(direct(service, "add-student-multiple", "AddStudent", inputOf(
            "studentList", studentValues(Arrays.asList(
                singleStudent("student-a", "p-a", "Student A").get(0),
                singleStudent("student-b", "p-b", "Student B").get(0))),
            "groupID", "group-1", "st", "1", "ed", "2", "maxRunYear", 0, "autoDeal", false
        ), new Invocation() {
            public Object invoke(String baseUrl) throws Throwable {
                com.itmc.train.webservice.shapan_qiyeguanli.StudentBaseClass[] students = new com.itmc.train.webservice.shapan_qiyeguanli.StudentBaseClass[]{
                    new com.itmc.train.webservice.shapan_qiyeguanli.StudentBaseClass("student-a", "p-a", "Student A"),
                    new com.itmc.train.webservice.shapan_qiyeguanli.StudentBaseClass("student-b", "p-b", "Student B")
                };
                return new com.itmc.train.newService.impl.QiyeguanlishapanInterfaceUtilService()
                    .getService(baseUrl).addStudent(students, "group-1", 1L, 2L, 0, false);
            }
        }, "[\"student-a\",\"student-b\"]"));
        list.add(direct(service, "add-student-null-optional", "AddStudent", inputOf(
            "studentList", studentValues(Arrays.asList(singleStudent("student-null", null, null).get(0))),
            "groupID", "group-1", "st", "1", "ed", "2", "maxRunYear", 0, "autoDeal", false
        ), new Invocation() {
            public Object invoke(String baseUrl) throws Throwable {
                com.itmc.train.webservice.shapan_qiyeguanli.StudentBaseClass[] students = new com.itmc.train.webservice.shapan_qiyeguanli.StudentBaseClass[]{
                    new com.itmc.train.webservice.shapan_qiyeguanli.StudentBaseClass("student-null", null, null)
                };
                return new com.itmc.train.newService.impl.QiyeguanlishapanInterfaceUtilService()
                    .getService(baseUrl).addStudent(students, "group-1", 1L, 2L, 0, false);
            }
        }, "[\"student-null\"]"));
        list.add(direct(service, "add-student-xml-special", "AddStudent", inputOf(
            "studentList", studentValues(Arrays.asList(singleStudent("学生&<一>\"'", "密码&<>\"'", "姓名中文&<>\"'").get(0))),
            "groupID", "班级&<>\"'", "st", "1", "ed", "2", "maxRunYear", 0, "autoDeal", false
        ), new Invocation() {
            public Object invoke(String baseUrl) throws Throwable {
                com.itmc.train.webservice.shapan_qiyeguanli.StudentBaseClass[] students = new com.itmc.train.webservice.shapan_qiyeguanli.StudentBaseClass[]{
                    new com.itmc.train.webservice.shapan_qiyeguanli.StudentBaseClass("学生&<一>\"'", "密码&<>\"'", "姓名中文&<>\"'")
                };
                return new com.itmc.train.newService.impl.QiyeguanlishapanInterfaceUtilService()
                    .getService(baseUrl).addStudent(students, "班级&<>\"'", 1L, 2L, 0, false);
            }
        }, "[\"student-1\"]"));
        list.add(direct(service, "get-stu-train-score", "GetStuTrainScore", inputOf(
            "type", 1, "groupID", "group-1", "studentIDList", new String[]{"student"}, "isMaxRunYear", true
        ), new Invocation() {
            public Object invoke(String baseUrl) throws Throwable {
                return new com.itmc.train.newService.impl.QiyeguanlishapanInterfaceUtilService()
                    .getService(baseUrl).getStuTrainScore(1, "group-1", new String[]{"student"}, true);
            }
        }, "[{\"nScore\":88}]"));
        list.add(direct(service, "get-stu-theory-score", "GetStuTheoryScore", inputOf("studentIDList", new String[]{"student"}), new Invocation() {
            public Object invoke(String baseUrl) throws Throwable {
                return new com.itmc.train.newService.impl.QiyeguanlishapanInterfaceUtilService()
                    .getService(baseUrl).getStuTheoryScore(new String[]{"student"});
            }
        }, "[{\"Score\":90}]"));
        list.add(direct(service, "reset-stu-end-time", "ResetStuEndTime", inputOf("studentID", "student", "endTime", "9223372036854775807"), new Invocation() {
            public Object invoke(String baseUrl) throws Throwable {
                return new com.itmc.train.newService.impl.QiyeguanlishapanInterfaceUtilService()
                    .getService(baseUrl).resetStuEndTime("student", Long.MAX_VALUE);
            }
        }, "\"ok\""));
        list.add(direct(service, "mark-stu-deleted", "MarkStuDeleted", inputOf("studentIDList", new String[]{"student"}), new Invocation() {
            public Object invoke(String baseUrl) throws Throwable {
                return new com.itmc.train.newService.impl.QiyeguanlishapanInterfaceUtilService()
                    .getService(baseUrl).markStuDeleted(new String[]{"student"});
            }
        }, "\"ok\""));
        list.add(direct(service, "del-student", "DelStudent", inputOf("studentIDList", new String[]{"student"}), new Invocation() {
            public Object invoke(String baseUrl) throws Throwable {
                return new com.itmc.train.newService.impl.QiyeguanlishapanInterfaceUtilService()
                    .getService(baseUrl).delStudent(new String[]{"student"});
            }
        }, "\"ok\""));
        list.add(direct(service, "get-system-info", "GetSystemInfo", inputOf(), new Invocation() {
            public Object invoke(String baseUrl) throws Throwable {
                return new com.itmc.train.newService.impl.QiyeguanlishapanInterfaceUtilService()
                    .getService(baseUrl).getSystemInfo();
            }
        }, "{\"OnlineUserCount\":\"3\"}"));
        list.add(direct(service, "get-run-state", "GetRunState", inputOf("groupID", "group-1"), new Invocation() {
            public Object invoke(String baseUrl) throws Throwable {
                return new com.itmc.train.newService.impl.QiyeguanlishapanInterfaceUtilService()
                    .getService(baseUrl).getRunState("group-1");
            }
        }, "\"running\""));
        list.add(trainingScenario(service, "training-entrance-student-classType1", 1, "AddTrainGroup"));
        list.add(trainingScenario(service, "training-entrance-student-classType3", 3, "AddMegagameGroup"));
        return list;
    }

    private static Scenario direct(String service, String name, String operation, Map<String, Object> input, Invocation invocation, String mockData) {
        return new Scenario(name, "official-axis-stub-direct", input, invocation).respond(operation, resultDataString(mockData));
    }

    private static Scenario trainingScenario(final String service, final String name, final int classType, final String groupOperation) {
        final JSONObject parameters = new JSONObject(true);
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
        parameters.put("classType", Integer.valueOf(classType));
        parameters.put("maxRunYear", Integer.valueOf(0));
        parameters.put("autoDeal", Boolean.FALSE);
        parameters.put("roleName", "student");
        parameters.put("teamName", "");
        Scenario scenario = new Scenario(
            name,
            "training-entrance",
            JSON.parseObject(parameters.toJSONString(), LinkedHashMap.class),
            new Invocation() {
                @Override
                public Object invoke(String baseUrl) throws Throwable {
                    return new TrainingEntrance().executeNew(service, "commonReturnStudentBaseInfo", parameters, baseUrl);
                }
            }
        );
        return scenario
            .respond("IsGroupExisted", resultDataString(null))
            .respond(groupOperation, resultDataString("group-1"))
            .respond("IsStuExisted", resultDataString("[]"))
            .respond("AddStudent", resultDataString("[\"student\"]"));
    }

    private static Map<String, Object> executeScenario(Scenario scenario, String baseUrl) {
        Active current = new Active(scenario);
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

    private static void writeFixture(File outputFile, String source, String operationName, String javaSignature,
                                     List<String> parameterNames, List<String> parameterTypes,
                                     List<Map<String, Object>> captures, File officialJar) throws Exception {
        Map<String, Object> contract = new LinkedHashMap<String, Object>();
        contract.put("operationName", operationName);
        contract.put("javaSignature", javaSignature);
        contract.put("parameterNames", parameterNames);
        contract.put("parameterTypes", parameterTypes);
        contract.put("soapAction", "http://tempuri.org/" + operationName);
        contract.put("returnNodeName", operationName + "Result");

        Map<String, Object> root = new LinkedHashMap<String, Object>();
        root.put("schemaVersion", 1);
        root.put("source", source);
        root.put("evidenceLevel", "official-captured");
        root.put("localhostOnly", Boolean.TRUE);
        root.put("productionTraffic", Boolean.FALSE);
        root.put("artifact", "itmc-tool-train-1.7.3.jar");
        root.put("artifactSha256", sha256(officialJar));
        root.put("redactions", Arrays.asList("clientinfo.Uname", "clientinfo.Password"));
        root.put("contract", contract);
        root.put("scenarioCount", captures.size());
        root.put("scenarios", captures);

        byte[] json = JSON.toJSONString(root, true).getBytes(StandardCharsets.UTF_8);
        File parent = outputFile.getParentFile();
        if (parent != null) parent.mkdirs();
        try (FileOutputStream output = new FileOutputStream(outputFile)) {
            output.write(json);
        }
        System.out.println("WROTE " + outputFile.getName() + " scenarios=" + captures.size());
    }

    public static void main(String[] args) throws Exception {
        if (args.length != 2) throw new IllegalArgumentException("expected: fixtureDir officialJarPath");
        File fixtureDir = new File(args[0]);
        File officialJar = new File(args[1]);

        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/normwebservice.asmx", StaticDerivedProfilesCapture::handle);
        server.start();
        installLoopbackOnlyNetworkGuard();
        // Axis stub 会自动拼接 /normwebservice.asmx?WSDL，这里只传根地址。
        String baseUrl = "http://127.0.0.1:" + server.getAddress().getPort();

        try {
            List<Scenario> management = managementScenarios();
            List<Map<String, Object>> managementCaptures = new ArrayList<Map<String, Object>>();
            for (Scenario scenario : management) managementCaptures.add(executeScenario(scenario, baseUrl));
            writeFixture(
                new File(fixtureDir, "official-management-accounting-captures.json"),
                "official itmc-tool-train-1.7.3.jar managementAccounting Axis Stub against loopback-only mock SOAP",
                "AddStudent", "String addStudent(StudentBaseClass[], String, long, long, int, boolean)",
                Arrays.asList("studentList", "groupID", "st", "ed", "maxRunYear", "autoDeal"),
                Arrays.asList("ArrayOfStudentBaseClass", "string", "long", "long", "int", "boolean"),
                managementCaptures, officialJar
            );

            List<Scenario> crossBorder = crossBorderScenarios();
            List<Map<String, Object>> crossBorderCaptures = new ArrayList<Map<String, Object>>();
            for (Scenario scenario : crossBorder) crossBorderCaptures.add(executeScenario(scenario, baseUrl));
            writeFixture(
                new File(fixtureDir, "official-cross-border-commerce-captures.json"),
                "official itmc-tool-train-1.7.3.jar crossBorderCommerce Axis Stub against loopback-only mock SOAP",
                "AddStudent", "String addStudent(StudentBaseClass[], String, long, long, boolean)",
                Arrays.asList("studentList", "groupID", "st", "ed", "startExam"),
                Arrays.asList("ArrayOfStudentBaseClass", "string", "long", "long", "boolean"),
                crossBorderCaptures, officialJar
            );

            List<Scenario> enterprise = enterpriseScenarios();
            List<Map<String, Object>> enterpriseCaptures = new ArrayList<Map<String, Object>>();
            for (Scenario scenario : enterprise) enterpriseCaptures.add(executeScenario(scenario, baseUrl));
            writeFixture(
                new File(fixtureDir, "official-enterprise-management-captures.json"),
                "official itmc-tool-train-1.7.3.jar enterpriseManagement Axis Stub against loopback-only mock SOAP",
                "AddStudent", "String addStudent(StudentBaseClass[], String, long, long, int, boolean)",
                Arrays.asList("studentList", "groupID", "st", "ed", "maxRunYear", "autoDeal"),
                Arrays.asList("ArrayOfStudentBaseClass", "string", "long", "long", "int", "boolean"),
                enterpriseCaptures, officialJar
            );
        } finally {
            server.stop(0);
        }
    }
}
