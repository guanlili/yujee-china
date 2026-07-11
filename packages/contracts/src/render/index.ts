// 渲染簇(页面真相 = HTML 的共享地基):web 与 design-agent 共同消费。
// 从 apps/web/src/components/album 迁入;web 侧原路径留转发壳保持既有 import 不破。
export * from './constants';
export * from './types';
export * from './font-catalog';
export * from './theme-carrier';
export * from './adapt-layout';
export * from './fill-template';
export * from './html-templates/registry';
