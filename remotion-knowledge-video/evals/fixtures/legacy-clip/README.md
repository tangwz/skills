# 旧片输入

这是评测时提供给两个执行组的同一份冻结项目，任务只要求提交方案，不修改本目录。入口为 `src/index.tsx`，Composition 为 `MechanismSection`。三个场景区间在 `src/clip-settings.ts` 中以帧保存。

`src/theme.ts` 保存已经确认的频道视觉配置；`src/LegacyBackdrop.tsx` 是现有画面使用的旧背景。`src/useClipFont.ts` 加载随输入提供的本地字体。字幕显示开关和字幕时间轴分别位于 `src/clip-settings.ts`、`src/narration.ts`，原始 SRT 在 `public/narration.srt`。画面的产品图标在 `src/MechanismSection.tsx` 内定义，仅用于说明内容。

可复用评测工作区已经安装的 React、Remotion 和 TypeScript。预览时以本目录的 `public` 为资源目录，不需要安装依赖或连接网络。

```sh
npx remotion studio skills/remotion-knowledge-video/evals/fixtures/legacy-clip/src/index.tsx --public-dir=skills/remotion-knowledge-video/evals/fixtures/legacy-clip/public
npx tsc -p skills/remotion-knowledge-video/evals/fixtures/legacy-clip/tsconfig.json
```
