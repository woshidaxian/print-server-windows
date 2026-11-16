# 打印服务器 · Windows 版（Print Server for Windows）

基于 **Node.js + Express** 的打印服务器 **Windows 适配版**。通过 HTTP 接口接收打印任务，支持多种文件格式，并通过 **Windows 打印后台处理程序（Print Spooler）+ PowerShell** 实时监控打印任务与打印机状态。附带开箱即用的 Web 监控面板。

> 本版本为 Windows 平台独立版本，与同级的 `print-server/`（CUPS 版，面向 macOS/Linux）互不干扰。两者 API 与配置文件格式完全一致，可交叉参考。

## 与 CUPS 版的区别

| 项目 | CUPS 版 (`print-server/`) | Windows 版 (`print-server-windows/`) |
|------|---------------------------|--------------------------------------|
| 打印后端 | `lp` / `lpstat` / `ipptool` | PowerShell + Windows Spooler (`Get-Printer` / `Get-PrintJob`) |
| 状态查询 | IPP 协议（`ipptool`） | PowerShell cmdlet + CIM/WMI |
| Office 打印 | 需 LibreOffice 转 PDF | 直接调用本机 **Word/Excel/PowerPoint/WPS** 的 COM 自动化 |
| 纯文本打印 | `lp` 直接提交 | `Out-Printer` |
| PDF/图片打印 | `lp` 直接提交 | 系统 Shell "打印" 谓词，或指定外部工具（PDFtoPrinter 等） |
| 默认打印机 | `lpstat -d` | `Win32_Printer` 的 Default 属性 |
| 打印服务状态 | `lpstat -r` | `Get-Service Spooler` |

## 功能特性

- ✅ HTTP 接口提交打印任务（multipart/form-data）
- ✅ 多格式：PDF、PNG/JPEG/GIF/TIFF/BMP/WebP、纯文本/TXT/CSV、PostScript/EPS
- ✅ Office 文档：DOC/DOCX/XLS/XLSX/PPT/PPTX/ODT/ODS/ODP/RTF —— 通过本机 Office/WPS 的 COM 自动化打印（**无需 LibreOffice**）
- ✅ 任务状态监控：排队中 → 打印中 → 已完成/出错/暂停（基于 `Get-PrintJob` 的 `JobStatus`）
- ✅ 打印机状态监控：空闲/打印中/已停止/卡纸/缺纸等（基于 `Get-Printer` 的 `PrinterStatus`）
- ✅ 打印选项：份数、纸张（部分经 COM/DEVMODE 生效）
- ✅ 取消任务：`Remove-PrintJob`
- ✅ Web 监控面板：实时查看状态、在线提交打印、一键取消
- ✅ 任务持久化到 `data/jobs.json`
- ✅ 平台抽象层：同一套代码可通过环境变量切换 CUPS / Windows 后端

## 环境要求

- **Windows 8 / Server 2012 及以上**（需包含 `Get-Printer`、`Get-PrintJob` 等 PrintManagement cmdlet；Win10/11 均支持）
- **Node.js >= 14**（已在 v14 / v18 / v22 验证；ID 生成不依赖 `crypto.randomUUID`）
- **Windows Print Spooler 服务正在运行**（默认开启）
- 打印 Office 文档时：本机需安装 **Microsoft Office**（或兼容 COM 自动化的 WPS Office）
- PDF/图片打印依赖系统关联程序的"打印"谓词；如需无人值守静默打印，建议配置外部工具（见下）

## 安装与运行

在 Windows 的 PowerShell 或 CMD 中：

```powershell
cd C:\path\to\print-server-windows
npm install
npm start
```

开发模式（文件改动自动重启，需 Node 18+）：
```powershell
npm run dev
```

启动后：
- 监控面板：http://localhost:3000
- API 地址：http://localhost:3000/api
- 健康检查：http://localhost:3000/api/health

### 以 Windows 服务方式后台运行（可选）

可用 `nssm` 或 `node-windows` 将 `node server.js` 注册为 Windows 服务，实现开机自启。此处不展开。

## 配置项

通过环境变量配置（PowerShell 设置示例：`$env:PORT = 8080`）：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `3000` | 服务端口 |
| `HOST` | `0.0.0.0` | 监听地址 |
| `MAX_FILE_SIZE` | `52428800` | 上传文件大小上限（字节，默认 50MB）|
| `POLL_INTERVAL` | `3000` | 任务状态轮询间隔（毫秒）|
| `KEEP_HISTORY_DAYS` | `7` | 历史任务保留天数 |
| `POWERSHELL_CMD` | `powershell.exe` | PowerShell 可执行文件（如用 PowerShell 7 可填 `pwsh.exe`）|
| `WIN_PRINT_TOOL` | `auto` | PDF/图片打印外部工具完整路径，`auto` 表示用系统 Shell/COM |
| `WIN_PRINT_TIMEOUT` | `90000` | 单次打印提交超时（毫秒）|
| `PRINT_BACKEND` | 自动 | 强制后端：`win` / `cups`（默认按操作系统自动选择）|

### 关于 PDF/图片静默打印

默认用 `Start-Process -Verb Print` 调用系统关联程序打印 PDF/图片。若希望**无人值守静默打印**（不弹任何窗口），建议安装 [PDFtoPrinter](https://www.eduela.org/download/) 或 [SumatraPDF](https://www.sumatrapdfreader.org/)，然后设置：

```powershell
$env:WIN_PRINT_TOOL = 'C:\Program Files\PDFtoPrinter\PDFtoPrinter.exe'
npm start
```

外部工具调用格式为：`工具 "打印机名" "文件路径"`，PDFtoPrinter / SumatraPDF 均兼容此调用方式。

## API 文档

与 CUPS 版完全一致，统一响应格式：

```json
{ "success": true, "data": { ... } }
{ "success": false, "error": { "code": "ERROR_CODE", "message": "..." } }
```

### 提交打印

`POST /api/print`（也支持 `POST /api/jobs`），Content-Type: `multipart/form-data`

| 字段 | 必填 | 说明 |
|------|------|------|
| `file` | 是 | 打印文件 |
| `printer` | 否 | 打印机名（Windows 上即"设备和打印机"里显示的名称），缺省用系统默认打印机 |
| `copies` | 否 | 份数，1-999 |
| `title` | 否 | 任务标题（用于在队列中识别任务）|
| `options` | 否 | JSON 字符串形式的打印选项，如 `{"pageSize":"A4"}` |

```powershell
curl.exe -X POST http://localhost:3000/api/print `
  -F "file=@C:\docs\report.pdf" `
  -F "printer=HP LaserJet Pro MFP" `
  -F "copies=2" `
  -F 'options={"pageSize":"A4"}'
```

其它接口：`GET /api/jobs`、`GET /api/jobs/stats`、`GET /api/jobs/:id`、`GET /api/jobs/:id/status`、`DELETE /api/jobs/:id`、`GET /api/printers`、`GET /api/printers/default`、`GET /api/printers/:name`、`GET /api/printers/:name/options`、`GET /api/printers/:name/jobs`、`GET /api/health`、`GET /api/system/info`。

### 任务状态

| 状态 | 对应 Windows JobStatus |
|------|------------------------|
| `pending` | Queued / Waiting / Restarted |
| `held` | Paused |
| `processing` | Printing |
| `completed` | Complete / Retained（或任务已离开队列）|
| `stopped` | Error |
| `cancelled` | Deleting |

### 打印机状态

| 状态 | 对应 Windows PrinterStatus |
|------|----------------------------|
| `idle` | Normal / Idle / Waiting |
| `processing` | Printing / Busy / IOActive / WarmingUp / Starting / Initializing |
| `stopped` | Paused / Error / Offline / NotAvailable / PaperJam / PaperOut / ManualFeed / PendingDeletion |

## 项目结构

```
print-server-windows/
├── server.js                     # 服务入口
├── src/
│   ├── config.js                 # 配置（含 Windows 段）
│   ├── app.js                    # Express 应用
│   ├── routes/                   # API 路由（与 CUPS 版一致）
│   ├── services/
│   │   ├── printBackend.js       # ★ 平台抽象层（按系统选后端）
│   │   ├── winprintService.js    # ★ Windows 打印后端
│   │   ├── cupsService.js        # CUPS 后端（保留，供跨平台/测试）
│   │   ├── printQueue.js         # 任务队列与提交逻辑
│   │   └── jobStore.js           # 任务持久化
│   └── utils/
│       ├── winCommand.js         # ★ PowerShell 执行与 JSON 解析
│       ├── command.js            # 普通命令执行（LibreOffice 等用）
│       ├── ipptool.js            # CUPS IPP 查询（Windows 下不加载）
│       ├── fileDetector.js       # 文件格式检测
│       ├── id.js                 # UUID 生成（兼容 Node 14）
│       ├── response.js           # 统一响应
│       └── logger.js             # 日志
├── public/index.html             # Web 监控面板
├── data/jobs.json                # 任务持久化（运行生成）
├── logs/server.log               # 日志（运行生成）
└── uploads/                      # 上传临时文件（运行生成）
```

## 实现说明

- **命令执行**：PowerShell 命令用 `-EncodedCommand`（UTF-16LE + Base64）传递，彻底避免中文打印机名与引号转义问题。
- **JSON 解析**：所有 PowerShell 查询输出 `ConvertTo-Json`，Node 端用括号配对的解析器提取，兼容单元素数组与中文。
- **状态判断**：任务不在打印队列中时视为已完成（Windows 打印完成后任务会被移出队列）。
- **Office 打印**：通过 COM 自动化调用 Word/Excel/PowerPoint 的 `PrintOut`，需本机安装对应软件；WPS 若注册了相同 ProgID 也可工作。
- **平台切换**：`printBackend.js` 根据 `process.platform` 或 `PRINT_BACKEND` 环境变量选择后端，上下层代码完全共用。

## 注意事项 / 已知限制

- **PDF/图片默认非静默**：用系统关联程序打印，可能弹出打印对话框；生产环境建议配置 `WIN_PRINT_TOOL` 为 PDFtoPrinter/SumatraPDF。
- **Office COM 依赖本机软件**：若未安装 Office/WPS，Office 文档打印会失败（返回错误）。
- **打印选项有限**：Windows 的 DEVMODE 选项（纸张/双面/彩色）读取已实现，但通过 Shell Print 提交时部分选项不会生效；使用 COM 提交 Office 文档时份数可生效。
- **需管理员权限的场景**：管理共享打印机、查询其他用户任务可能需要提升权限。
- **无鉴权**：生产环境对外暴露前应增加 API Key/鉴权中间件。
- 本项目在 macOS 开发环境完成编写与 mock 测试；实际 Windows 打印行为请在目标 Windows 机器上验证。
