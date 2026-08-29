// 设计真相源：配色表 + 风格表。design-agent 是独立包，够不着 apps/web，
// 所以这些表必须住在 contracts —— apps/web 侧留 re-export 薄壳保持导入路径不变。
export * from './third-set-palette';
export * from './page-backgrounds';
export * from './contrast';
