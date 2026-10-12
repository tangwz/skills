# 口播与时间轴对齐

视频总长跟随口播预算，动作跟随句意与关键讲解词；整体倍速或总长相同不能证明中段对齐。批量稿件先按 [分段规则](batch-transcripts.md) 拆分，每片独立计时。

## 时间依据

| 输入                | 编排依据与交付表述                                 |
| ------------------- | -------------------------------------------------- |
| 同版录音及词/句时码 | 实测区间与核对过的讲解词，注明核对范围             |
| 录音但无时码        | 测媒体时长并试听定位句意，区分已核对与待核对锚点   |
| 确认时码但无音频    | 按用户时码编排，注明尚未试听                       |
| 只有稿件            | 按实际念法、语速与停顿估算中心值和范围，待录音校准 |

核对稿件与录音版本、剪辑、首尾静音和偏移；不自动裁掉用户需要的停顿。音频与时码冲突时先查版本及剪辑点。固定片长若容不下完整口播，说明冲突并建议简化图解或拆分；删改稿件、截断或拉伸音轨须有授权。只做旧作视觉适配时不重排时序。

## 录音与确认时码

用项目现有媒体工具读取实际音频时长，没有词级时码时试听定位语义边界和重要讲解词。可用已有转写/对齐工具，但需核对数字、缩写与公式。片内偏移只加一次，区分源音频、局部和全局时码：

```text
globalCueSeconds = audioStartSeconds + localCueSeconds
videoEndSeconds = audioStartSeconds + retainedAudioSeconds + extraTailSeconds
```

`extraTailSeconds` 默认零，增加时说明用途。前置画面已计入 `audioStartSeconds`；稿内开场和总结承载品牌段，模板的片头、片尾与样片秒数不额外追加。

## 稿件估时

保留原稿，另外整理实际念法。未朗读的标题、镜头提示、Markdown 标记和出处不计时；开场与总结计入。数字、单位、逐字母缩写和公式按完整口头读法计算，不按源码长度计数。图解文字不增加朗读时长，必要阅读停顿单列。

优先用同一讲述者、相近知识密度的录音或用户语速校准；计数口径一致，公式密集段可另设局部语速。**语速样本已含停顿时不重复添加标点停顿**。

无样本时可暂用中文 4 字/秒、英文 2.5 词/秒，逗号 0.2 秒、句末 0.4 秒、段间 0.6 秒；同一边界只取一种停顿。按语速上下浮动约 15% 给出快慢范围，并注明未校准。唐师兄频道可按 [个人语速参考](speaker-profiles/tang-shixiong.md) 暂定预算，其他讲述者不继承该样本。字幕时轴只是代理估计，需记录样本区间、计数和停顿口径，不能仅凭整片时长推断语速。

```text
estimatedSeconds = chineseSpokenCharacters / chineseCharactersPerSecond
                 + englishSpokenWords / englishWordsPerSecond
                 + plannedPauseSeconds
```

逐段预算之和决定口播中心总长；额外画面预算另列一次。不要选择最慢估计再加尾巴，或套固定秒数整体压短。文字估时不能称为已证明音画同步。

## 段落与动作

沿用项目的数据格式，每段关联原稿句/编号、起止秒数及依据、讲解词时点、对应动作的开始或完成目标，以及停顿和稳定区。按“先 A、再 B、得到 C”的实际讲解顺序呈现，不提前亮出全部结果，也不落后于下一步骤。

预算紧时缩短装饰入场、并行呈现独立元素、删重复演示或减少图中文字；因果步骤仍按顺序推进，不靠整体倍速或延长片长解决。结尾先完成动作，再利用总结和已有停顿保持稳定；额外阅读区说明差值。前景与背景采用同一稳定区，满足模板合法时长，不缩短用户明确指定的停留。

## 帧换算与检查

内部绝对边界按共用 fps 四舍五入，从相邻边界求时长，避免分段累积误差。音频覆盖从**实际挂载起始帧**加上保留音频与额外尾段的帧跨度；跨度仅消除正整数边界附近的浮点噪声，再向上取整：

```ts
function ceilFrameSpan(seconds: number, fps: number) {
  const frames = seconds * fps;
  const nearest = Math.round(frames);
  const tolerance = 4 * Number.EPSILON * Math.max(1, Math.abs(frames));
  const stableFrames =
    nearest > 0 && Math.abs(frames - nearest) <= tolerance ? nearest : frames;
  return Math.ceil(stableFrames);
}

const startFrame = Math.round(startSeconds * fps);
const endFrame = Math.round(endSeconds * fps);
const durationInFrames = endFrame - startFrame;
const cueFrame = Math.round(globalCueSeconds * fps);
const audioStartFrame = Math.round(audioStartSeconds * fps);
const totalFrames =
  audioStartFrame + ceilFrameSpan(retainedAudioSeconds + extraTailSeconds, fps);
```

`31 / 60` 秒在 60 fps 下仍为 31 帧；真实不足一帧的尾音必须保留，正短跨度不能吸附为零。不要用固定毫秒容差、未取整的起点或把整数起点换回秒后再乘来计算覆盖。

片尾另有已声明结束边界时取两者最大值。最后场景结束于注册总帧数，音频子 `Sequence` 的可见区间与裁取设置覆盖保留音频，不能只延长空白视频。文字预算可取中心估计的四舍五入总帧数。同帧短段共享画面或合并视觉区间；口播变化后重算该段及后续边界，不只修改总长。注册和场景消费同一份时序数据。

验收分别核对：

- **总长**：实际音频挂载帧、保留时长和声明预算。向上取整误差小于一帧；挂载偏移四舍五入误差另记，通常不超过半帧。估算只与中心预算比较。
- **进度**：全部场景边界与讲解词，连贯复查开场、中段、结尾。确认锚点与指定动作目标默认相差不超过 0.3 秒，用户更严格时从其要求；这不是整段动画的最长耗时。
- **结尾**：动作落定，保留最后一句及所需停顿，无重复追加品牌段或截断音频。

有音频时试听；静帧、状态和容器时长不能证明声音同步。交付逐段表、依据、口播/视频时长、差值及来源，未试听或待录音替换的估算明确标注。

编码后同时核对视频流、音频流与容器时长。AAC 填充或延迟不反向加入口播预算；发现位移或尾音异常时检查裁取、混音及编码。可用无损混音后一次最终编码，复核成片开头与末尾。
