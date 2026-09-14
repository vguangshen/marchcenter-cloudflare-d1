-- Java 班级删除映射迁移到竞赛卡片级：每个卡片可独立配置删除平台数据库班级行的
-- 表/列映射（启用/平台类型/数据库/班级表/班级名列/班级ID列/级联子表），
-- 仅当卡片 SSO 方式为 JAVA 接口时使用。存储为 JSON 文本。
ALTER TABLE competitions ADD COLUMN class_delete_mapping TEXT;
