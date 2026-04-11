# P2P File Transfer

局域网 P2P 文件传输工具，使用 WebRTC 实现点对点直连，无需服务器中转文件数据。

## 功能特性

- **房间模式**：通过 URL 参数 `?roomid=xxx` 进入同一房间
- **P2P 传输**：WebRTC DataChannel 直接传输，不经过服务器
- **多文件支持**：支持选择多个文件批量传输
- **分片传输**：64KB 分片，支持大文件传输
- **实时进度**：传输速度、进度百分比、ETA 显示
- **目标选择**：可发送给特定 Peer 或广播给所有 Peer
- **深色主题**：终端风格工业风 UI

## 技术栈

- **前端**：React 18 + TypeScript + Vite
- **后端**：Node.js + Express + Socket.io（仅用于信令）
- **传输**：WebRTC DataChannel

## 快速开始

### 1. 安装依赖

```bash
# 根目录安装（同时安装 server 和 client 依赖）
npm install

# 或分别安装
cd server && npm install
cd ../client && npm install
```

### 2. 启动服务

```bash
# 同时启动服务端和客户端（推荐）
npm run dev

# 或分别启动
# 终端 1：启动信令服务器
cd server && npm run dev

# 终端 2：启动前端开发服务器
cd client && npm run dev
```

### 3. 访问应用

打开浏览器访问：`http://localhost:5173`

## 使用说明

1. **创建/加入房间**：
   - 输入房间 ID 或点击 "Generate ID" 生成随机 ID
   - 点击 "Join Room" 进入房间
   - 或直接访问 `http://localhost:5173?roomid=你的房间ID`

2. **分享房间**：
   - 点击房间 ID 旁的复制按钮
   - 将链接分享给同一局域网的其他用户

3. **发送文件**：
   - 拖拽文件到上传区域，或点击选择文件
   - 选择目标 Peer（点击左侧列表）或保持 "All Peers"
   - 点击 "Send" 按钮发送

4. **接收文件**：
   - 文件自动接收并显示在 "Received Files" 区域
   - 点击 "Download" 按钮下载文件

## 项目结构

```
p2p-transfer/
├── server/              # 信令服务器
│   ├── index.js         # Socket.io 信令服务
│   └── package.json
├── client/              # React 前端
│   ├── src/
│   │   ├── hooks/
│   │   │   ├── useWebRTC.ts    # WebRTC 逻辑
│   │   │   └── useRoom.ts      # 房间管理
│   │   ├── components/
│   │   │   ├── RoomJoin.tsx    # 房间加入页面
│   │   │   ├── PeerList.tsx    # 对等节点列表
│   │   │   ├── FileDropZone.tsx # 文件拖拽上传
│   │   │   ├── TransferProgress.tsx # 传输进度
│   │   │   └── FileTransfer.tsx # 接收文件列表
│   │   ├── styles/
│   │   │   └── index.css       # 样式
│   │   ├── App.tsx
│   │   └── main.tsx
│   ├── index.html
│   ├── package.json
│   └── vite.config.ts
└── package.json
```

## 工作原理

1. **信令阶段**：通过 Socket.io 服务器交换 WebRTC 连接所需的 SDP offer/answer 和 ICE candidates
2. **连接建立**：Peer 之间建立 P2P 连接（优先尝试局域网直连）
3. **数据传输**：通过 WebRTC DataChannel 直接传输文件分片
4. **文件重组**：接收方按顺序重组分片并生成可下载文件

## 注意事项

- 确保所有设备在同一局域网内，或能够互相访问
- 防火墙可能阻止 WebRTC 连接，必要时需要配置
- 大文件传输时请勿刷新页面，否则传输会中断

## License

MIT
