# 共用风格输入

这是评测时提供给两个执行组的同一份冻结项目。`src/index.tsx` 注册 `SignalEpisode` 和 `LongTitleEpisode`，二者共用 `src/style.ts`，后一支有自己的局部网格和字号覆盖。频道身份是已确认的演示频道 `Demo Science`，图标由代码内的 SVG 绘制。

`src/Episodes.tsx` 包含现有背景、品牌标记和三个场景；`src/video-settings.ts` 保存两支视频的帧率与场景边界。`starter/defaults.ts` 是创建下一期时使用的默认配置副本。输入保留修改前的网格参数，评测执行者收到的任务另行说明需要调整的数值。

可直接复用评测工作区已安装的 React、Remotion 和 TypeScript，无外部资源和网络请求。

字体按字符分工：英文沿用 Arial，中文使用宋体（macOS 的 `Songti SC`，Windows 的 `SimSun`）。正文为 400，标题、副标题和强调为 700；强调文字使用对应粗体字重。字体栈将 Arial 放在前面，避免宋体接管英文。生产默认与 starter 保存相同的字体配置。

本输入使用系统安装的字体。两组和各自修改前后的画面必须在同机，或相同操作系统、浏览器版本与实际字体文件的环境下比较，并保持画布尺寸与缩放一致。渲染前确认 Arial 及所选宋体在 400/700 下实际使用的字体，记录 700 是否由浏览器合成；合成策略也应一致，不要求存在独立的 `SimSun Bold` 文件。不能将缺字体后的静默回退作为有效布局证据。跨机器检查应记录实际字体名称、版本或文件哈希。

```sh
npx remotion studio skills/remotion-knowledge-video/evals/fixtures/shared-style/src/index.tsx
npx tsc -p skills/remotion-knowledge-video/evals/fixtures/shared-style/tsconfig.json
```
