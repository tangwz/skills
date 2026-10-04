# 目标项目接入

本页用于首次接入品牌模板或跨项目复用。技能提供共用视觉资源；项目入口、字体文件、品牌身份、字幕策略和现有时间轴由目标项目提供。不要求目标项目存在固定的源码文件名。

## 发现并复用现有实现

读取目标项目可用的规则与 `package.json`，沿 Composition 注册追踪实际场景、主题、字体加载和媒体资源。已有品牌层时优先接入其配置与组件；缺少品牌层时再复制模板。`src/video-brand/` 是建议目录，可按项目结构调整。

| 接入项             | 从目标项目确认的内容                                  |
| ------------------ | ----------------------------------------------------- |
| 入口与 Composition | 实际入口、ID、尺寸、fps、总帧数和注册方式             |
| 主题与布局         | 品牌配置来源、背景和语义色、共用组件及安全区          |
| 字体               | 加载方式、真实 family alias、字重、语言覆盖与授权文件 |
| 资源               | 实际 public 目录、频道身份素材与内容素材的用途        |
| 字幕与媒体         | 项目约定、实际显示控制、数据来源和音视频对齐点        |

项目规则未定义字幕策略时，按本次任务判断，不继承其他项目的字幕开关或文件操作要求。旧视频适配保持现有时间轴与媒体对齐，新增片头片尾或改变帧率需属于本次请求。

复制 `VideoChrome.tsx` 时，一并复制其依赖的 `video-style.ts`、`video-brand.ts`、`grid-motion.ts` 和 `end-card-timing.ts`。复制 `BrandPreview.tsx` 时，还需复制 `VideoChrome.tsx` 及上述四个辅助模块，保持相对导入可解析。

## 字体接入

品牌组件接收 `VideoFontRoles`，只依赖 `title`、`body`、`chinese`、`mono` 四个角色，不依赖具体字体模块。已有字体 loader 时在外层调用它，并传入实际注册的 family alias。

没有现有 loader 时，可使用模板导出的 `useLocalVideoFonts`。将获授权的文件放入目标项目的 public 目录，按角色声明路径、字重和格式，再在外层加载。例如以下路径是假定素材，使用前必须替换为实际文件；模板不包含这些字体文件：

```tsx
import { BrandPreview } from "./video-brand/BrandPreview";
import {
  useLocalVideoFonts,
  VIDEO_FONT_ROLES,
  type LocalVideoFont,
} from "./video-brand/video-style";

const fontSources: LocalVideoFont[] = [
  { role: "title", path: "fonts/display.woff2", weight: "100 900" },
  { role: "body", path: "fonts/body.woff2", weight: "100 900" },
  { role: "chinese", path: "fonts/chinese.woff2", weight: "100 900" },
  { role: "mono", path: "fonts/mono.woff2", weight: "100 900" },
];

export const ChannelStylePreview = () => {
  useLocalVideoFonts(VIDEO_FONT_ROLES, fontSources);
  return <BrandPreview fonts={VIDEO_FONT_ROLES} />;
};
```

示例字重范围仅适用于对应的可变字体。静态字体按实际字重分别列出来源，并覆盖组件会用到的字重；不要以示例范围代替文件的真实能力。字体加载失败应阻止交付，避免机器间字体回退造成画面变化。模板 loader 只缓存成功或进行中的加载，失败后移除对应记录；修正路径后重新挂载预览即可重试。

模板字体 hook 为每次已提交的配置创建独立等待句柄，只注册当前配置的字体；配置切换或卸载后，旧请求不能解除新的等待、取消新的渲染或注册过期字形。多个实例共享同一字体时，卸载其中一个不会注销其余实例仍在使用的字体。

## 注册与迁移边界

`BrandPreview.tsx` 导出样片的宽、高、fps 和总帧数，注册时读取这些值；正常视频读取目标项目共用配置。首次建立品牌时以样片检查字体、长标题、Logo 和片尾，再在各期内容中复用共用层。样片的 `content` props 支持片头标题及说明、正文标题及说明、结论；品牌和风格分别由 `brand`、`styleOverrides` 注入，不通过修改共用组件更换单期文案。

样片的流程图是中文用法示例，内部节点标签不属于上述五项可注入文案。其他语言或知识结构使用自己的场景组件；独立英文标题通过 `TitleCard` 的 `fontRole` 选择已加载的英文角色，不把示例当作任意内容都适用的成片。

多场景视频在 Composition 外层放一份 `KnowledgeBackground`，向内部 `EpisodeOpener`、`EpisodeEndCard` 传入 `showBackground={false}`，避免局部帧从零开始导致移动网格跳变。外层背景的 `holdSeconds` 按整个 Composition 的结束时间计算；只有需要稳定结尾的完整时间轴才传入它。

模板的 `getEndCardTiming` 按实际 fps 统一换算片尾、稳定区和入场帧数。正片尾时长必须不少于 `endHoldSeconds`，否则明确报错；片尾为零时同时关闭该片尾的稳定区。片尾与稳定区等长时，从片尾首帧完整显示结论。外层背景使用计算结果的 `holdFrames / fps`，确保背景静止区与前景入场完成时间一致，不静默缩短用户设置的稳定区。

独立使用 `EpisodeEndCard` 时，它读取实际 Composition 或所在 `Sequence` 的 `durationInFrames` 来限制入场，不要求该时长等于配置中的片尾默认值。实际帧数必须足以容纳完整稳定区，否则明确报错；两者等长时首帧完整显示。使用外层背景时，仍需让外层稳定区与片尾在总时间轴上的位置对齐。

跨项目只带走所需模板与获授权素材。复制后调整导入路径和配置，确认每个资源都来自目标项目或技能包；不引用原项目的字体 hook、主题模块、字幕模块或本机绝对路径。预览入口与检查脚本作为目标项目文件维护，临时打包缓存不作为运行依赖。
