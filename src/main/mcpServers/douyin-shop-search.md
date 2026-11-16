# 抖音商城查询 MCP

服务器名：`douyin-shop-search`。界面复用 `message.tools.mcp.webSearchPro`，中文显示 **联网搜索：联网搜索PRO**，并沿用 scrapt 的收起详情、搜索分组和积分徽标。

## 商品工具与中转路由

所有请求均为 GET，仅调用自己的固定服务 `https://open.vectcut.com/justoneapi/douyin-ec/`。

| 工具 | 参数 | 路由 |
|---|---|---|
| `search_products` | keyword；可选 page、search_id | item-search |
| `get_product_details` | item_id | item-details |
| `get_product_skus` | item_id | item-sku |
| `get_product_comments` | item_id；可选 page | item-comments |
| `get_shop_products` | shop_id；可选 page | shop-items |

MCP参数使用snake_case，转发为上游兼容的itemId/shopId/searchId。ID必须为字符串，不能把19位商品ID当JS number。拒绝未知参数、用户身份和计费覆盖项、任意URL/路径。

使用 `agentRuntimeAuthService.ensureValidAccessToken()` 取得用户登录Token，以Bearer传给自己的FC服务。桌面端不保存JustOneAPI上游凭证。业务成功码是 `code=0`，不同于scrapt的200。165秒本地请求超时，Agent注册180秒。网络/上游/未知错误不自动重试；仅自己的明确执行前401 UNAUTHORIZED可刷新用户Token后再发一次。

## 与 scrapt 组合

1. 用scrapt用户搜索或用户资料确认抖音号、uid、sec_uid，不混淆同名或关联账号。
2. 读取作品列表，再查单条视频。可用 `douyin_web_fetch_one_video`，设置`need_anchor_info=true`；商品卡通常在 `aweme_detail.anchor_info.extra` 的JSON字符串中。
3. 拿到`product_id`后查商品详情，确定店铺；用搜索中的`summary_promotions`查询明确月销和日序列，再以shop_id盘点店铺。
4. 商品月销、累计已售、达人个人归因成交、直播GMV是不同口径。视频列表的promotions/anchors为空不表示不挂车。字段缺失需检查其他可用详情接口，不能猜商品ID或用全商品销量归到本人。
5. 直播或达人转化查询需另用scrapt星图接口；缺失不证明没有成交。本服务还包含33个星图接口；星图未覆盖时仍需scrapt辅助查ID/公开资料。

已在相关scrapt用户/视频工具描述中反向加入组合指引。没有让工具自动连调scrapt或自动全量翻页，所有额外调用由Agent按任务选择并分别计费。

## 计费显示

FC负责`project_id=48`、每次成功一单位，不在客户端硬编码积分单价。保留完整响应text及structuredContent.billing，便于大结果保存时继续展示计费。

- 有实际`total_consumed_points`等消耗字段：沿用原显示。
- 仅有`status=queued`和`estimated_points`：显示`≈2.00`等预估数值及预估提示，不伪造成已结算总消耗。
- `unknown`/`not_charged`等没有实际金额时：不凭空生成金额徽标。
- 分组中有任意预估时，总徽标也带`≈`；同一个响应同时出现text与structuredContent不会重复计数。

## 注册与测试

同时加入Agent运行时`claudecode/tools/registry.ts`和本地聚合`LocalAggregateMcpService.ts`，使用与scrapt相同的自动允许策略。

```bash
pnpm exec vitest run --config src/main/mcpServers/__tests__/douyin-shop-search.vitest.config.mjs
pnpm exec vitest run --config src/main/mcpServers/__tests__/douyin-shop-search-ui.vitest.config.mjs
```

前一组测试MCP真实内存连接、五条路由、鉴权、错误、计费透传及相关回归；后一组测试PRO标题、收起详情、分组和徽标。网络均mock，不产生实际费用。

源码变更后需重启开发主进程或重新构建应用，并在新Agent会话中刷新工具目录；不会动态注入到已经运行的旧会话。


## 完整40个工具（2.0）

五个商品工具保留，新增`search_users`、`get_video_details`和33个星图工具。冻结契约内联在douyin-shop-search.ts的XINGTU_CONTRACTS，与后台xingtu_catalog.json相同，不需要运行时读取后台本地文件，不请求动态OpenAPI。

星图工具：search_creators；get_creator_profile/link_structure/visibility/channel_metrics/order_experience/link_metrics；get_video_distribution；get_audience_distribution；get_marketing_metrics；get_spread_metrics；get_conversion_analysis；get_showcase_products；get_conversion_resources；get_cost_effectiveness；get_audience_touchpoints；get_recommended_videos；get_fans_distribution；get_video_report_trend/detail/analysis；get_comment_keywords；get_daily_fans；get_content_keywords；get_business_card；get_commerce_spread_info；get_creator_videos；get_creator_tags；get_creator_side_info；get_live_statistics；get_live_audience；get_commerce_seeding_info；get_creator_contract_info。斜杠表示共享前缀的独立工具。

所有MCP参数用snake_case，映射到FC接受的camelCase；布尔参数是boolean而非字符串，日期校验真实YYYY-MM-DD及先后次序，ID坚持数字字符串。星图视频报告item_id是作品ID，与商品详情item_id含义不同，描述中明确提醒。无效的文档数字枚举默认值不暴露。get_live_audience没有period参数，不能假设为指定30天画像。

业务内层data.base_resp.status_code或data.status_code明确非0时标isError；保留原响应与计费，缺失指标null/“-”不伪造业务失败或成交0。所有工具复用相同用户凭证、消耗显示和取消/无重试策略。

先部署已扩展40接口的FC版本（包含xingtu_catalog.json），再重启/构建桌面主进程，开启新会话。仅旧5接口版本的FC会对新工具返回404；不要自动收费重试。
