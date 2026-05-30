# Catapult-CN 项目规则

## 关键约束

- 所有修改必须经过用户在 diff 视图中审核
- 测试结果以本地命令输出和用户确认为准
- 不在用户确认前声称"已完成""已修复""已通过"
- 每次只处理一个阶段或一个聚焦问题

## 高风险文件

- `src-tauri/src/lib.rs` - 只出精确补丁，不完整覆盖
- `src-tauri/src/server.rs` - 注意 Windows 条件编译
- `src/pages/Server.tsx`（1300+ 行） - 只出精确补丁，不完整覆盖

## 验证命令

```bash
# TypeScript 检查
npx tsc --noEmit
# Rust 编译检查
cd src-tauri && cargo check
```

## 预设命名约束

- 预设名称中禁用 `/` 字符（Windows 路径兼容性）
- 使用 `-` 或中文字符替代

## 国际化规则

- 所有界面文本必须通过 `en.json` / `zh.json` 管理
- 使用 `t("server.labels.xxx")` 翻译函数调用
- 新增翻译键必须同时添加中英双语
