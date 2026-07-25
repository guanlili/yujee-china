// 纯类型迁至 @yujee/contracts/render;React 组件类型留在 web。
export type {
  TemplateDataValue,
  TemplateArrayItem,
  TemplateData,
  ImagePos,
  TemplateRenderProps,
  ToCItem,
  GridCell,
} from '@yujee/contracts/render';

// 渲染注册表的唯一真相是 `components/album/web-registry.ts`(WEB_TEMPLATE_REGISTRY)。
// 这里曾有一个 TemplateEntry 形状供第二套注册表使用,该注册表已随矢量 PDF 渲染器一同
// 退役删除;不要再在 templates/ 下新建注册表。
