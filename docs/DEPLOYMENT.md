# 自行部署

D500 Workbench 是静态前端，不需要数据库或应用后端。服务器只提供页面和资源，信道文件、内置驱动与串口通信均在访问者的浏览器内处理。

新增型号的运行时资源会随构建自动放入 `dist/radio/`，必须完整部署该目录。所有资源由同源提供，不依赖外部 CDN。页面必须保留 `Cross-Origin-Opener-Policy: same-origin`、`Cross-Origin-Embedder-Policy: require-corp`；CSP 需允许同源 Worker 和 `wasm-unsafe-eval`，项目 Nginx 配置已包括这些设置。不要把内置 Python 源文件当作服务器脚本执行，它们只作为静态资源供浏览器加载。

## 构建与静态托管

```sh
npm ci
npm run build
```

将 `dist/` 部署到静态服务器。Web Serial 要求安全上下文：本机可使用 `localhost` / `127.0.0.1`，远程访问需 HTTPS。

发行源码包可在提交代码后生成：

```sh
node scripts/package-release.mjs
```

这会在 `dist/` 中加入对应提交的 `source.zip`、`LICENSE.txt` 和 `version.json`。发布修改后的程序时请同时提供 GPL 要求的对应源码及许可信息。

## Docker 与反向代理

仓库提供 `deploy/compose.yml` 和 `deploy/nginx.conf`：

- 目录 `current/` 挂载静态文件；`nginx.conf` 与 Compose 文件位于同一部署目录。
- 容器 `d500-web` 监听 `8080`，通过名为 `proxy` 的外部 Docker 网络连接反向代理。
- 容器使用固定镜像摘要、非 root 用户和只读文件系统。

首次准备目录、复制构建产物并创建网络后启动：

```sh
mkdir -p current
cp -R dist/. current/
cp deploy/compose.yml compose.yml
cp deploy/nginx.conf nginx.conf
docker network inspect proxy >/dev/null 2>&1 || docker network create proxy
docker compose up -d
```

生产环境也可使用下文的版本目录发布方式，避免复制过程中混用新旧资源。

### Nginx Proxy Manager

为你自己的域名创建 Proxy Host：

| 项目 | 配置 |
| --- | --- |
| Scheme | `http` |
| Forward hostname | `d500-web` |
| Forward port | `8080` |
| SSL | 为自己的域名签发证书并开启 Force SSL |
| Cache assets | 关闭，静态资源由文件哈希和应用服务器控制 |
| Websockets | 不需要 |

反代应与应用容器处于同一网络。保留应用的 `Permissions-Policy` 响应头，尤其不要额外设置 `serial=()`；否则浏览器会拒绝串口访问。

## SSH 版本目录发布

`scripts/deploy.sh` 要求显式设置自己的 SSH 目标。目标服务器需已有 Docker Compose、部署目录和 `proxy` 网络：

```sh
D500_SSH_HOST=your-ssh-host bash scripts/deploy.sh
```

可通过 `D500_SSH_PROXY_COMMAND` 指定自己的 SSH 代理命令。脚本不包含维护者的域名、主机别名或凭据。

脚本会构建并打包当前已提交源码，上传到 `/opt/d500-web/releases/<commit>`，原子切换 `current` 链接，并检查容器健康。前一版本记录在 `previous-release`，旧版本目录保留。

回退时先核对目标版本，再在服务器执行：

```sh
cd /opt/d500-web
test -f previous-release
ln -sfn "$(cat previous-release)" current.next
mv -Tf current.next current
docker compose up -d --force-recreate d500-web
docker exec d500-web wget -q -O - http://127.0.0.1:8080/health
```

## 发布检查

- 自己的 HTTPS 域名正常，证书有效。
- `/`、`/health` 与带哈希的静态资源可访问；缺失资源返回 404。
- `/version.json` 的提交号与所部署源码一致，`/source.zip` 与许可证可下载。
- 文件导入、编辑、导出与本地草稿恢复正常。
- 浏览器可使用 Web Serial；服务器无需访问 USB，也不接收配置文件。

仓库不提供公共演示站点或维护者的生产环境配置。

## 内置驱动资源检查

Nginx 默认类型表可能没有 `.mjs`，必须使用仓库配置中的模块类型规则；否则在保留 `nosniff` 的情况下，浏览器会拒绝加载内置驱动。`/radio/` 的缺失资源返回 404，不回退到首页。

部署脚本会检查容器内三个入口模块的返回类型。设置 `D500_PUBLIC_URL` 后，还会检查反向代理后的十个驱动资源及隔离响应头；也可单独运行：

```sh
node scripts/verify-radio-assets.mjs https://your-host/
```
