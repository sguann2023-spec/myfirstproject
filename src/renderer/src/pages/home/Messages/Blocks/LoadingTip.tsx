import React from 'react'
import styled from 'styled-components'

const LOADING_TIPS = [
  '音频画面对不齐？试试把模型的思考强度开到最高',
  '模型回答被中断，还可以发送继续让他继续回答',
  '先让AI生成一条视频确认画面节奏，再让他制作草稿',
  '讲清楚你想要发布的平台，他会针对性的优化',
  '在右侧打开工作空间，然后打开你素材所在的文件夹',
  '生成的草稿需要导出到剪映里才能查看',
  '配音不好听想要换个音色？可以在音频工具里找到合适的音色',
  '使用克隆音色功能，克隆自己的音色',
  'GPT Image 2.6现在可以生成透明背景的gif图了',
  'Minimax生成的视频比较便宜，但是效果不如seedance',
  '想要保持语速语调不变只换音色？试试变声功能',
  '想要生成多人对话的音频？试试AI音频生成的功能。',
  'vectcut不仅仅可以生成人声，还可以生成雨声、流水声等环境音',
  '忘记拍摄素材？试试让他搜索你想要的视频、画面、音频',
  '只想给视频加个字幕？跟他说我想套用字幕模版',
  '想要去气口？直接说！',
  '把照片发给AI，让他制作一条你自己的数字人视频。',
  '在剪映里制作好预设样式，然后通过#导入，让AI模仿',
  '不知道拍什么？让他全网搜热点',
  '想看竞对的销售情况？让他去搜索',
  '参考视频就是最好的提示词！',
  '视频处理都在本地，偶尔需要画面理解才会截图上传到云端',
  '混剪的视频素材，会缓存打标结果，下次就不需要再次打标',
  '这个结果比较满意？让他保存成技能，下次通过@直接触发',
  '正在对话的任务，也可以发送消息，他会等任务结束自动发送',
  '在设置页面里可以清理 vectcut 的缓存文件以释放磁盘空间',
  '生成草稿要比生成视频更加消耗token，但是草稿可以人工精调',
  '怀疑一条视频是AI生成或者某个片段是AI生成，发给他让他确定',
  '同一个工作空间里的对话，共享操作文件',
  '一个对话太长，不仅会导致tokens消耗增多，也会导致效果下降'
] as const

const LoadingTip: React.FC = () => {
  const [tipIndex, setTipIndex] = React.useState(() => Math.floor(Math.random() * LOADING_TIPS.length))

  React.useEffect(() => {
    const timer = window.setInterval(() => {
      setTipIndex((previous) => {
        // Pick uniformly from all tips except the currently visible one.
        const next = Math.floor(Math.random() * (LOADING_TIPS.length - 1))
        return next >= previous ? next + 1 : next
      })
    }, 12000)
    return () => window.clearInterval(timer)
  }, [])

  return <TipText className="message-loading-tip">{LOADING_TIPS[tipIndex]}</TipText>
}

const TipText = styled.span`
  min-width: 0;
  overflow-wrap: anywhere;
  font-size: 12px;
  line-height: 1.5;
  color: #8c8c8c;
`

export default React.memo(LoadingTip)
