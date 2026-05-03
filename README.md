# chatgpt2api image workspace

一个只面向 **本平台内部使用** 的轻量图片工作台：

- 登录时填写 **上游 API URL** 和 **上游 API Key**
- 服务端校验这组凭据是否符合 **NewAPI 转出的标准 OpenAI 绘图接口**
- 登录后由本平台服务端内部调用上游接口生成图片
- 普通用户与管理员权限分离，管理员需使用 `CHATGPT2API_ADMIN_PASSWORD` 单独登录
- 固定只保留 `gpt-image-2`
- 保留平台内的 **文生图 / 参考图 / 编辑图 / 本地历史**
- 不再对外提供二次 OpenAI 兼容反代接口给第三方客户端调用

> 当前项目已移除 / 停用：注册机、官网逆向、账号池、`access_token` 导入、文本对话代理、Responses / Messages，以及对外 `/v1/images/generations` 之类的代理定位。

## 保留能力

- Web 登录（基于 URL + Key）
- 基础设置
- 图片工作台（文生图 / 参考图 / 编辑图 / 服务端历史）
- 同一组 `API URL + API Key` 跨浏览器共享图片任务记录
- 管理记录页：查看 prompt、图片结果、任务状态，并设置图片保留天数等
- 必要的服务端鉴权与配置持久化
- Web 内部使用的图片任务接口

## 固定兼容目标

- 上游：NewAPI 转出的标准 OpenAI 绘图接口
- 固定模型：`gpt-image-2`
- 单次生成 / 编辑数量上限：默认 `10`
  - 管理员可通过 `max_images_per_request` 配置为 `1~10`
  - 当数量 `>1` 时，平台会在服务端拆成多个 **并发的 `n=1` 上游请求** 后再聚合结果，避免把多图 `n` 直接透传给兼容性不稳定的上游
  - 若上游个别 `n=1` 子请求意外返回多于 1 张图，平台会保留并返回这些额外图片；仅在总返回数少于请求下限时才判失败
- Web 尺寸选项：`auto`、`1024x1024`、`1536x1024`、`1024x1536`

## 快速开始

```bash
docker compose up -d
```

启动后访问：

- Web：`http://localhost:3000`
- 版本：`http://localhost:3000/version`

## Compose / 环境变量说明

- 仓库当前可直接执行 `docker compose up -d` 启动，**`.env` 不是必需**。
- 主 compose 现在只挂载 `./data:/app/data`，**不再依赖 repo root `config.json`**。
- 管理员在页面里保存的全局设置会持久化到 `data/config.json`。
- 只有在你想预置管理员密码、全局 upstream 配置，或覆盖默认保留天数 / 会话密钥 / 单次最多生成张数时，才需要从 `.env.example` 复制出 `.env`。
- 若某个全局项已由环境变量显式提供，则运行时会以环境变量为准，管理界面会将该字段锁定为只读。
- `docker-compose.yml` 使用远程镜像：`ghcr.io/spacex-3/chatgpt2api:latest`
- `docker-compose.local.yml` 使用本地 `Dockerfile` 构建镜像，便于本地改代码调试。

如需本地构建镜像而不是直接拉取 GHCR 镜像，可使用：

```bash
docker compose -f docker-compose.local.yml up -d --build
```

此时默认访问：

- Web：`http://localhost:8000`
- 版本：`http://localhost:8000/version`

## 首次登录

### 普通用户

- 上游 API URL，例如 `https://your-newapi.example.com/v1`
- 上游 API Key

服务端会先校验上游 `/v1/models` 是否可用，并检查是否可用于 `gpt-image-2`。

普通用户登录后：

- 可访问 `/image`、`/settings`
- 自己发起的图片任务只使用**自己当前会话**的上游 URL + Key
- 不会写回或污染管理员的全局配置

### 管理员

管理员通过登录页的“管理员”入口，使用环境变量 `CHATGPT2API_ADMIN_PASSWORD` 登录。

若未设置 `CHATGPT2API_ADMIN_PASSWORD`，则仍可正常启动普通用户工作台，但不能使用管理员登录。

管理员登录后：

- 可访问 `/admin`
- 可查看全部图片任务记录
- 可维护全局 `upstream_api_url / upstream_api_key / proxy / base_url / image_retention_days / max_images_per_request`
- 未被环境变量锁定的全局项会持久化到 `data/config.json`

## 基础设置

普通用户在 `/settings` 中可维护自己当前会话的：

- `upstream_api_url`
- `upstream_api_key`

管理员在 `/settings` / `/admin` 中可维护全局：

- `upstream_api_url`
- `upstream_api_key`
- `proxy`
- `base_url`
- `image_retention_days`
- `max_images_per_request`

管理员密码不写入 `data/config.json`，只通过环境变量提供：

```bash
CHATGPT2API_ADMIN_PASSWORD=change_me
```

## 运行方式说明

本项目**不再作为第三方客户端可调用的 OpenAI 兼容图片 API 代理**。

默认工作流是：

1. 用户登录本平台
2. 在本平台内保存 URL + Key
3. Web 界面通过服务端内部接口提交图片生成或编辑任务
4. 服务端调用上游 NewAPI 标准绘图接口
5. 返回结果并落本地图片缓存

## 本地图片缓存

- 服务端会尽量把上游返回的图片结果落到本地 `data/images/`
- `base_url` 用于生成可访问的图片 URL
- `image_retention_days` 用于自动清理过期缓存
- 管理员保存的全局配置默认落到 `data/config.json`

## 其他环境变量补充

当前运行中的 Web / Compose 只会读取以下运行时环境变量：

- `CHATGPT2API_ADMIN_PASSWORD`
- `CHATGPT2API_SESSION_SECRET`
- `CHATGPT2API_UPSTREAM_API_URL`
- `CHATGPT2API_UPSTREAM_API_KEY`
- `CHATGPT2API_PROXY`
- `CHATGPT2API_BASE_URL`
- `CHATGPT2API_IMAGE_RETENTION_DAYS`
- `CHATGPT2API_MAX_IMAGES_PER_REQUEST`

仓库里仍有 `STORAGE_BACKEND`、`DATABASE_URL`、`GIT_REPO_URL`、`GIT_TOKEN`、`GIT_BRANCH`、`GIT_FILE_PATH` 这些变量的读取代码，但它们目前仅用于 `scripts/migrate_storage.py` / `scripts/test_storage.py` 辅助脚本，不是当前 image workspace 的 compose 运行时必需项。

## 主要代码入口

- 登录 / 设置：`api/system.py`
- 内部图片任务接口：`api/image_tasks.py`
- 上游调用：`services/upstream_openai_image_client.py`
- 会话鉴权：`services/session_service.py`
- Web 工作台：`web/src/app/image`

## 免责声明

本项目仅用于合法的图片生成工作台场景。请遵守上游服务条款、当地法律法规以及内容安全要求。
