# 部署说明

## 目标

- 域名：`d500.example.com`（DNS 已指向现有 VPS）。
- SSH：本机既有别名 `d500-host`，可通过 `D500_SSH_HOST` 覆盖。
- 服务器目录：`/opt/d500-web`。
- 容器：`d500-web`，固定镜像摘要，非 root、只读文件系统、无新增宿主机公网端口。
- 网络：已有 `proxy` 外部 Docker 网络。
- Nginx Proxy Manager：转发 `http://d500-web:8080`。

## 版本发布

1. `npm ci`、`npm test`、`npm run build` 通过。
2. 提交和推送源码，工作树保持干净。
3. `bash scripts/deploy.sh`：构建后打包当前 Git 提交对应的源码，上传 `releases/<commit>`，切换 `current`，启动容器并检查健康端点。
4. 验证 `https://d500.example.com/version.json` 的 revision 与提交一致。

发布保留前一版本路径到 `previous-release`，不删除旧版本目录。正常更新只改静态文件版本；除配置有变更外，不重复修改 NPM。

## NPM 主机

通过现有 NPM 管理页面或 API 创建/更新：

- Domain：`d500.example.com`
- Scheme：`http`
- Forward hostname：`d500-web`
- Forward port：`8080`
- Block common exploits：开启
- Cache assets：关闭（由应用静态服务按内容哈希控制）
- Websockets：不需要
- Certificate：为该子域签发的 Let's Encrypt 证书，交给 NPM 自动续期
- Force SSL：开启
- HTTP/2：开启

首次调整前备份 NPM SQLite 数据库。不要直接编辑其生成的代理配置；应通过 NPM 保存主机和证书。

## 回退

在服务器中执行以下操作前先确认 `previous-release` 指向预期的版本目录：

```sh
cd /opt/d500-web
test -f previous-release
ln -sfn "$(cat previous-release)" current.next
mv -Tf current.next current
docker compose up -d --force-recreate d500-web
docker exec d500-web wget -q -O - http://127.0.0.1:8080/health
```

保持 `proxy` 网络和 NPM 主机不变。浏览器草稿与导入文件存放在浏览器端，服务器回退不修改用户文件。

## 验证

- HTTP 自动跳转到 HTTPS；证书主机名正确且未过期。
- `/`、哈希资源、`/health`、`/source.zip`、`/LICENSE.txt`、`/version.json` 可访问。
- `.env` 等隐藏文件不可读，缺失的静态资源返回 404。
- 浏览器导入、编辑、导出正常；刷新恢复本机草稿。
- 没有文件上传 API，应用不把 DAT、工作表或方案内容发送到服务器。
- 连接电台通过浏览器 Web Serial 访问用户选择的本机写频线。HTTPS 响应应包含 `Permissions-Policy: camera=(), microphone=(), geolocation=(), serial=(self)`；NPM 不得额外下发冲突的 `serial=()`。服务器不连接 USB，也不接收读机内容。

v0.3.0-beta.1 更新了容器侧权限头。回退到旧版文件编辑器时，也应恢复对应版本的 `deploy/nginx.conf` 并重建容器。
