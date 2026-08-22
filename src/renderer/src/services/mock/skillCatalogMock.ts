import type { SkillCatalogDetail, SkillCatalogItem } from '@renderer/types/skillCatalog'
import childrenPictureBookCover from '../../../../../resources/quick/skills/儿童绘本/website/cover.jpg'

const icon = (background: string, label: string) => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" rx="18" fill="${background}"/><text x="32" y="40" text-anchor="middle" font-family="Arial" font-size="28" font-weight="700" fill="#fff">${label}</text></svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

const items: SkillCatalogItem[] = [
  {
    id: 'qq-music-assistant', slug: 'qq-music-assistant', name: 'QQ音乐助手',
    description: '支持歌曲搜索、每日推荐、AI 歌单生成、排行榜分析、歌手和专辑查询、听歌报告、音乐风格推荐以及根据用户偏好整理播放列表等多种音乐能力。',
    icon_url: icon('#f4c51c', 'Q'), version: '1.0.0',
    author: { id: 'official', name: '官方' }, tags: ['音乐', '搜索'], featured_rank: 1
  },
  {
    id: 'east-money-search', slug: 'east-money-search', name: '东方财富搜索',
    description: '基于东方财富数据库，支持自然语言查询金融数据，覆盖 A 港美、基金、债券等多种资产。',
    icon_url: icon('#ef2b23', '东'), version: '1.0.0',
    author: { id: 'official', name: '官方' }, tags: ['金融', '搜索'], featured_rank: 2
  },
  {
    id: 'tencent-news', slug: 'tencent-news', name: '腾讯新闻',
    description: '7×24 新闻搜索工具，聚焦国内外热点，支持热榜、早晚报和实时资讯查询。',
    icon_url: icon('#24a85a', '腾'), version: '1.0.0',
    author: { id: 'official', name: '官方' }, tags: ['新闻'], featured_rank: 3
  },
  {
    id: 'dingtalk-suite', slug: 'dingtalk-suite', name: '钉钉套件',
    description: '覆盖消息、日历、待办、审批、考勤、日志、文档和 AI 表格等产品能力。',
    icon_url: icon('#45a8e8', '钉'), version: '1.0.0',
    author: { id: 'official', name: '官方' }, tags: ['办公'], featured_rank: 4
  },
  {
    id: 'douyin-hot', slug: 'douyin-hot', name: '抖音热榜',
    description: '获取抖音实时热榜 TOP50，支持历史回溯与定时推送。',
    icon_url: icon('#262626', '抖'), version: '1.0.0',
    author: { id: 'official', name: '官方' }, tags: ['短视频'], featured_rank: 5
  },
  {
    id: 'xiaohongshu-copywriter', slug: 'xiaohongshu-copywriter', name: '小红书笔记创作',
    description: '基于爆款笔记数据，AI 提炼流量密码，生成可直接发布的小红书文案。',
    icon_url: icon('#f20d46', '小'), version: '1.0.0',
    author: { id: 'official', name: '官方' }, tags: ['小红书', '文案'], featured_rank: 6
  },
  {
    id: 'children-picture-book', slug: 'children-picture-book', name: '儿童绘本',
    description: '生成儿童绘本故事，支持睡前故事、幼儿故事和角色故事创作。',
    icon_url: icon('#f2b21e', '绘'), version: '1.0.0',
    author: { id: 'official', name: '官方' }, tags: ['绘本'], featured_rank: 7
  },
  {
    id: 'travel-guide', slug: 'travel-guide', name: '旅游攻略混剪',
    description: '旅行主题一键混剪，支持旅拍素材、攻略口播和空镜内容编排。',
    icon_url: icon('#3d9be9', '旅'), version: '1.0.0',
    author: { id: 'official', name: '官方' }, tags: ['旅行', '视频'], featured_rank: 8
  },
  {
    id: 'live-clipping', slug: 'live-clipping', name: '直播切片',
    description: '从直播回放、课程直播和访谈中自动识别高光并生成短视频切片。',
    icon_url: icon('#7a4be8', '切'), version: '1.0.0',
    author: { id: 'official', name: '官方' }, tags: ['直播', '视频'], featured_rank: 9
  }
]

const detailMap: Record<string, SkillCatalogDetail> = Object.fromEntries(items.map((item) => [item.id, {
  ...item,
  media: item.id === 'children-picture-book' ? [{ type: 'image' as const, url: childrenPictureBookCover }] : [],
  skill_md: {
    content: `# ${item.name}\n\n${item.description}\n\n## 使用方式\n\n在对话中 @${item.name}，然后告诉我你希望完成的任务。`
  },
  package: { type: 'directory' as const }
}]))

export const mockSkillCatalog = {
  async listFeatured(limit = 20, offset = 0) {
    const data = items.slice(offset, offset + limit)
    return { code: 0, message: 'success', data, total: items.length, limit, offset }
  },
  async searchSkills(query: string, limit = 20, offset = 0) {
    const normalized = query.trim().toLowerCase()
    const matched = items.filter((item) => item.name.toLowerCase().includes(normalized))
    const data = matched.slice(offset, offset + limit)
    return { code: 0, message: 'success', data, total: matched.length, limit, offset }
  },
  async getSkillDetail(skillId: string) {
    const data = detailMap[skillId]
    if (!data) throw new Error('技能不存在')
    return { code: 0, message: 'success', data }
  }
}
