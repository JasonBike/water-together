# 咕噜日记 · Water Together

一个给情侣、室友和朋友使用的可爱饮水小站。

咕噜日记把“记得喝水”变成两个人一起完成的小习惯：输入昵称即可进入，不需要密码；每个人可以设置自己的水杯容量、性别和固定头像；每天分别记录接水、喝水和上厕所次数，再用图表看看一天里的生活节奏。

这是一个重前端、轻社交的第一版原型，重点放在轻松记录、可爱反馈和清晰的数据展示上。

## 体验概览

- **登录即开始**：昵称就是当前账号 ID，不引入密码和复杂注册流程。
- **已有账号选择**：登录页会列出服务器里的成员，点击头像即可直接进入对应账号；点击“注册新账号”后再填写新昵称和个人设置。
- **个人小档案**：登录时选择 250 / 350 / 500 / 750 ml 水杯容量、性别和固定头像。
- **自己的记录**：当前登录账号可以记录接水、喝水和上厕所，也可以撤销刚刚的操作。
- **查看搭子**：可以点击成员查看对方的当天统计、小时节奏图和近 7 日汇总；进入别人空间时为只读，不能替对方累计或重置。
- **搭子提醒**：查看别人时可以送出一颗“记得喝水”小水滴，提醒会写入服务器。
- **每日小纸条**：话术按日期保存，可编辑；每个账号每天可点赞或取消点赞，历史日期会保留对应点赞数。
- **日期浏览**：支持前后翻页、自绘日历直接选择日期，以及回到今天。
- **节奏图表**：使用 ECharts 绘制 24 小时折线图，展示接水、喝水和上厕所的次数集中时段；点击图例可以单独隐藏或显示某条曲线。
- **容量估算**：根据“接水次数 × 水杯容量”估算每日和近 7 日饮水量；喝水次数不设上限。
- **温柔反馈**：记录成功会有按钮弹跳、图标跳动和小粒子动画；重置记录使用同风格确认弹层。
- **成长与共同目标**：显示情侣当天共同接水进度（固定 10 杯）、温柔连续记录、7 日热力图和累计接水水杯成长等级。
- **每日小纸条**：当天没有内容时默认连接本机 OpenAI 兼容服务自动生成；服务不可用时使用内置默认话术，也可以点击“换一句”。历史日期不会自动请求模型。
- **移动端反馈**：支持设备震动时，记录和发送提醒会有轻触感反馈。

## 本地启动

```bash
npm install
npm run dev:api

# 另开一个终端，启动 Vite 热更新页面
npm run dev
```

开发时 API 地址为 `http://localhost:8787/`，页面地址为 `http://localhost:5173/`。Vite 会把 `/api` 请求代理到 API 进程。

生产构建：

```bash
npm run build
```

## 生产环境启动

目标服务器需要 Node.js `22.5.0` 或更高版本：

```bash
node --version
```

在服务器上执行：

```bash
git clone git@github.com:JasonBike/water-together.git
cd water-together
npm ci
npm run build
PORT=8787 node server.mjs
```

启动后访问：`http://服务器地址:8787/`。

`server.mjs` 会同时提供前端静态文件和 `/api` 接口，运行时只需要这一个 Node 进程，不需要再启动 SQLite、MySQL 或 Redis 进程。需要后台托管时，将下面这个命令交给 systemd、Docker 或其他进程管理器即可：

```bash
PORT=8787 node server.mjs
```

也可以使用快捷命令（会先构建再启动）：

```bash
npm start
```

生产数据默认写入 `data/water-together.sqlite`，请确保运行用户对 `data/` 有写权限，并把该目录加入备份。建议把数据库放到应用目录之外：

可通过环境变量修改监听端口或数据库文件位置：

```bash
PORT=8080 WATER_DB_PATH=/var/lib/water-together/water.sqlite node server.mjs
```

每日小纸条默认请求本机的 OpenAI 兼容服务：

```text
接口：http://127.0.0.1:8317/v1/chat/completions
模型：gpt-5.6-terra
鉴权：不需要 API Key
```

模型请求只发送日期和固定的写作要求，不发送饮水记录、昵称或其他成员资料；模型不可用时会自动回退到内置默认话术。若部署服务器上的模型服务地址不同，需要修改 `server.mjs` 顶部的固定地址和模型常量。

## 功能明细

- 无密码昵称登录
- 登录页选择已有成员账号
- 登录时设置水杯容量、性别和固定头像
- 添加多位饮水搭子并查看成员空间
- 按日期查看记录；只有当前登录账号可以补记
- 日期支持前后翻页、直接选择某一天和回到今天
- 分别记录接水与喝水次数
- 独立记录上厕所次数
- 每人每日 8 次接水目标和进度（喝水次数不限）
- 情侣共同接水目标（固定 10 杯）
- 全员当日统计
- 近 7 日汇总：每日接水/喝水次数与按杯容量估算的饮水量
- ECharts 当日水站节奏折线图：按小时展示接水、喝水和上厕所的次数集中度
- 每日小纸条编辑和点赞
- 每日小纸条自动生成（可选大模型，带默认话术兜底）
- 单次操作撤销
- 按当前日期重置当前账号记录（清空前确认）
- SQLite 文件持久化（`data/water-together.sqlite`）
- 桌面与移动端响应式布局

## 技术栈

- React 19
- TypeScript
- Vite
- ECharts（按需加载折线图、坐标轴、Tooltip 和 Canvas 渲染器）
- CSS 原生响应式布局与插画式视觉

## API 接口

生产环境 API 和页面使用同一个地址，默认基地址为 `http://localhost:8787`。开发环境页面运行在 `5173`，Vite 会自动代理 `/api` 到 `8787`。

所有写接口都使用 JSON 请求体，并返回 JSON；成功删除返回 `204 No Content`。

### 获取初始化数据

```http
GET /api/bootstrap
```

返回成员、饮水记录、提醒、小纸条和点赞关系：

```json
{
  "members": [
    {
      "id": "member-abc",
      "name": "小兔",
      "emoji": "🐰",
      "color": "#f8c8cc",
      "gender": "secret",
      "cupCapacity": 350
    }
  ],
  "actions": [
    {
      "id": "action-abc",
      "memberId": "member-abc",
      "type": "drink",
      "date": "2026-09-03",
      "time": "14:30",
      "createdAt": 1770000000000
    }
  ],
  "nudges": [],
  "notes": [
    { "date": "2026-09-03", "content": "水要慢慢喝，\\n喜欢要一直在。", "likes": 2, "updatedAt": 1770000000000 }
  ],
  "noteLikes": [
    { "date": "2026-09-03", "memberId": "member-abc" }
  ]
}
```

### 创建或更新成员

```http
POST /api/members
Content-Type: application/json
```

请求字段：

```json
{
  "id": "member-abc",
  "name": "小兔",
  "emoji": "🐰",
  "color": "#f8c8cc",
  "gender": "female",
  "cupCapacity": 350,
  "createdAt": 1770000000000
}
```

`name` 最多 12 个字符；`gender` 可选 `female`、`male`、`secret`；`cupCapacity` 可选 `250`、`350`、`500`、`750`。同名成员会执行更新，不会重复创建。成功返回成员对象，参数不合法返回 `400`。

### 增加一次记录（+1）

```http
POST /api/actions
Content-Type: application/json
```

请求字段：

```json
{
  "id": "action-abc",
  "memberId": "member-abc",
  "type": "fetch",
  "date": "2026-09-03",
  "time": "14:30",
  "createdAt": 1770000000000
}
```

`type` 可选：

- `fetch`：接水
- `drink`：喝水
- `restroom`：上厕所

一次 `POST /api/actions` 就代表对应类型增加 1 次。成员不存在或字段不合法返回 `400`，成功返回 `201` 和保存后的记录。

例如增加一次喝水：

```bash
curl -X POST http://localhost:8787/api/actions \
  -H 'Content-Type: application/json' \
  -d '{
    "id": "action-drink-001",
    "memberId": "member-abc",
    "type": "drink",
    "date": "2026-09-03",
    "time": "14:30",
    "createdAt": 1770000000000
  }'
```

### 减少一次记录（-1）

```http
DELETE /api/actions/{actionId}
```

例如：

```http
DELETE /api/actions/action-abc
```

成功返回 `204`。

接口没有直接修改某个总数的 `count` 参数，减少次数的方式是删除对应的那一条 action。前端的“撤销”按钮就是调用这个接口；删除后，统计、图表和汇总会重新按剩余 action 计算。

### 清空某成员某天的记录

```http
DELETE /api/actions?memberId=member-abc&date=2026-09-03
```

只删除指定成员、指定日期的全部记录，成功返回 `204`。它相当于把该成员当天的接水、喝水和上厕所次数全部归零；前端只会对当前登录成员启用此操作。

### 给搭子发送喝水提醒

```http
POST /api/nudges
Content-Type: application/json
```

请求字段：

```json
{
  "id": "nudge-abc",
  "fromMemberId": "member-me",
  "toMemberId": "member-abc",
  "date": "2026-09-03",
  "time": "15:10",
  "createdAt": 1770000000000
}
```

`fromMemberId` 和 `toMemberId` 必须是两个已存在的成员。成功返回 `201` 和提醒记录；参数不合法返回 `400`。提醒记录会随 `/api/bootstrap` 一起返回。

### 编辑每日小纸条

```http
POST /api/notes
Content-Type: application/json
```

请求字段：

```json
{
  "date": "2026-09-03",
  "content": "今天也要慢慢喝水\\n给自己一个拥抱"
}
```

每个日期一条小纸条；重复提交同一天会更新话术。`content` 长度为 1–160 个字符，成功返回该日期的小纸条和当前点赞数。

### 自动生成每日小纸条

```http
POST /api/notes/generate
Content-Type: application/json
```

请求字段：

```json
{ "date": "2026-09-03" }
```

调用固定的 OpenAI 兼容 Chat Completions 接口；模型调用失败时使用内置默认话术。生成结果会保存到该日期，后续查看历史日期时仍可读到。

### 给每日小纸条点赞 / 取消点赞

```http
POST /api/notes/{date}/like
Content-Type: application/json
```

请求体：

```json
{ "memberId": "member-abc" }
```

同一成员对同一天重复调用会在点赞和取消点赞之间切换，返回：

```json
{
  "note": { "date": "2026-09-03", "content": "...", "likes": 3 },
  "liked": true
}
```

### API 权限边界

当前是无密码昵称原型：成员和记录接口没有服务端登录态，前端负责把别人的空间设为只读。因此它适合内网、个人服务器或原型体验；如果公开部署，需要增加 Cookie/Token 登录，并在服务端校验操作者是否有权写入对应 `memberId`。

## 数据、账号与权限

成员资料和饮水记录由单进程 Node API 写入 SQLite 文件 `data/water-together.sqlite`。SQLite 使用 WAL 和事务模式，不需要单独启动数据库服务。

- 同一昵称对应成员表中的一条成员记录，登录时会更新昵称对应的头像、性别和水杯容量。
- 不同浏览器和设备访问同一个部署地址时，会读取同一个 SQLite 文件，因此可以共享数据。
- “查看别人”是前端只读视图；当前昵称登录方案没有密码，正式上线时仍需要服务端鉴权和权限校验。
- SQLite 文件不应提交到 Git，部署时请备份 `data/` 目录。

## 目录结构

```text
water-together/
├── src/
│   ├── App.tsx       # 登录、成员、记录、图表和弹层交互
│   ├── main.tsx      # React 入口
│   └── styles.css    # 页面视觉、响应式和动画
├── index.html
├── server.mjs       # 静态文件服务、API 和 SQLite 持久化
├── data/             # 运行时创建，保存 SQLite 文件
├── package.json
└── vite.config.ts
```
