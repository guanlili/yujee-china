// 移动端画板双态交互的纯逻辑与命令式挂载。见 MOBILE-CANVAS-DESIGN.md。

export type DeviceMode = 'mobile' | 'desktop';

// 单一响应式判定源。等价于现有散落三处的 matchMedia('(max-width:767px)')。
// 边界 767/768 与该媒体查询一致(<=767 为 mobile)。
export function resolveDeviceMode(width: number): DeviceMode {
  return width <= 767 ? 'mobile' : 'desktop';
}

export type Density = 1 | 2 | 4;

// 一屏几页:点一下循环。含义见 DESIGN(1 看细节 / 2 对页 / 4 找位置)。
export function cycleDensity(d: Density): Density {
  return d === 1 ? 2 : d === 2 ? 4 : 1;
}

// 当前屏应显示的页 index。末屏不足按实际短返回,不补越界(避免渲染空格子)。
export function pageWindow(startIdx: number, density: Density, total: number): number[] {
  const out: number[] = [];
  for (let i = startIdx; i < startIdx + density && i < total; i++) {
    if (i >= 0) out.push(i);
  }
  return out;
}

// 把 start 对齐到 density 边界并夹进合法范围。换档时用它保证仍看着原页所在的那一屏。
export function clampStart(startIdx: number, density: Density, total: number): number {
  const clamped = Math.max(0, Math.min(startIdx, Math.max(0, total - 1)));
  return Math.floor(clamped / density) * density;
}

// 画布可视高度 = 屏高 - 顶栏 - 位置条 - dock。替代 book-stage 硬编码 padding-bottom:220px。
export function canvasVisibleHeight(
  screenH: number,
  topbarH: number,
  subbarH: number,
  dockH: number,
): number {
  return Math.max(0, screenH - topbarH - subbarH - dockH);
}

export type PanelKind = 'edit' | 'chat' | 'delete';
export type PanelSpec = {
  form: 'sheet' | 'dialog';
  heightPx: number | null;
  resizable: boolean;
};

// 编辑类二级面板统一 2/3 固定;AI 对话 2/3 起步但可拖;删除是居中 dialog(同分享)。
export function panelSpec(kind: PanelKind, screenH: number): PanelSpec {
  if (kind === 'delete') return { form: 'dialog', heightPx: null, resizable: false };
  const twoThirds = Math.round((screenH * 2) / 3);
  return { form: 'sheet', heightPx: twoThirds, resizable: kind === 'chat' };
}

export type CanvasState = 'browse' | 'edit';
export type GestureInput = {
  state: CanvasState; pointers: 1 | 2; axis: 'x' | 'y' | null; onSelectedImage: boolean;
};
export type GestureOwner =
  | 'scroll-strip' | 'page-nav' | 'density' | 'zoom' | 'pan-image' | 'scroll-page' | 'none';

// 手势契约表(见 DESIGN)落成纯函数:先看态,再看目标。
// 关键:编辑态"拖"只在已选中图上成立 → 机制上消灭"想拖图结果画布飘走"。
export function arbitrateGesture(g: GestureInput): GestureOwner {
  if (g.pointers === 2) return g.state === 'browse' ? 'density' : 'zoom';
  // 单指:已选中图上的任意拖动 = 改构图(编辑态专属)
  if (g.state === 'edit' && g.onSelectedImage) return 'pan-image';
  if (g.axis === 'x') return 'page-nav'; // 两态横滑都翻(浏览翻屏/编辑翻页)
  // 竖滑:浏览态画布不滚 → none;编辑态滚页
  return g.state === 'edit' ? 'scroll-page' : 'none';
}

export type MobileCanvasCtx = {
  root: HTMLElement;
  getWidth: () => number;
  enterEdit: (pageIndex: number) => void;
  exitEdit: () => void;
  openBoardBg: () => void; // 复用 EditorBook 的 openBoardBgModal
  totalPages: () => number;
  renderGrid: () => void; // 复用 EditorBook 的 renderOverview
  openPageBg: () => void; // 编辑态一级栏「背景」→ 复用现有 openMobileSheet('page')
  openChat: () => void; // 展开现有可变高对话面板(移除 root 的 chat-collapsed),AI 气泡点击触发
  isEditingPhase: () => boolean; // mode === 'editing'(区别于 authoring 创作期靠对话生成书)
  chapters: () => { label: string; spread: number }[]; // 现有 renderRail 的章节数据原样喂给位置条(#304 Task14)
  // 页号(pagesState 数组下标)→ spread 序号的精确映射,复用桌面侧已有的
  // spreadIndexOfPage(spreads, pageIndex)(#304 Important fix1)。取代之前 flat/2 的近似换算 ——
  // 那个近似在封面/结尾独页处会漂移,EditorPort.tsx 里两处(computeChapterSpread /
  // spreadOfFlatPage)已经为同样的理由改用精确映射,这里补齐第三处。
  spreadOfPage: (pageIndex: number) => number;
};

// initMobileCanvas 的返回值:teardown 卸载态机(原样保留);refreshChapters 是章节数据
// 异步到达后的重渲染钩子(#304 Important fix2)——editing 模式的 chapters 来自异步
// fetch,挂载时首帧渲染跑在 fetch resolve 之前,chips 会因为 chapters 为空而隐藏;
// fetch 成功后除了现有的桌面 renderRail(),还要调这个钩子让位置条重渲一次。
// 桌面宽度/未进入移动分支时是安全的 no-op(不指向任何已卸载的 DOM)。
export type MobileCanvasHandle = {
  teardown: () => void;
  refreshChapters: () => void;
};

// 命令式挂载点。桌面宽度下不建任何 DOM/监听(仅靠上层 resize 复算),保证桌面零回归。
export function initMobileCanvas(ctx: MobileCanvasCtx): MobileCanvasHandle {
  let state: CanvasState = 'browse';
  let density: Density = 2;
  let startIdx = 0;
  const cleanups: Array<() => void> = [];
  // 桌面态/未挂载移动分支时的缺省值:安全 no-op,不指向任何 DOM。
  let refreshChapters: () => void = () => {};

  // 仅在移动宽度时接管;桌面为 no-op。
  if (resolveDeviceMode(ctx.getWidth()) === 'mobile') {
    const ovGrid = ctx.root.querySelector<HTMLElement>('#ovGrid');
    const ovBoard = ovGrid?.closest<HTMLElement>('.book-overview') ?? ovGrid;

    if (ovGrid && ovBoard) {
      // 移动画板已接管的标记:CSS 据此隐藏旧桌面浮层(ctrl-dock 视图切换、canvas-hint
      // 「切换到编辑模式」提示)—— 它们被新的左下角密度/背景钮 + 点页进编辑取代。
      // 未挂载(桌面/失败)时无此类,旧控件照常显示,零回归。
      ctx.root.classList.add('mc-on');
      cleanups.push(() => ctx.root.classList.remove('mc-on'));

      // 移动端 + 编辑期(mode==='editing')默认收起对话面板,画布占满、AI 气泡当入口
      // (用户拍板 #304 fix)。创作期(authoring)靠对话生成书,不动 —— isEditingPhase()
      // 为 false 时这里不跑。只在挂载时加一次,之后用户手动展开(openChat 移除该类)
      // 是正常 toggle,不在这里强制重加。
      if (ctx.isEditingPhase()) {
        ctx.root.classList.add('chat-collapsed');
      }

      // 编辑态:点某页 → 该页宿主格子撑满可视区,renderGrid() 后按新 clientWidth
      // 重绘(不用 transform 放大糊)。手势走 arbitrateGesture 裁决:单指横滑翻页
      // (到头夹住)、竖滑放行滚动、已选中图上的拖动交给现有构图逻辑(留 Task 10)。
      // 左缘 20px 的按下不接管横滑,让给 iOS 边缘返回手势。
      let editPageIndex: number | null = null;
      // 左下角两钮 + 底部缩略条:命令式建 DOM,一次性挂进 root(不依赖 renderOverview 的
      // innerHTML 重建,所以不会被格子重绘冲掉)。
      const densBtn = document.createElement('button');
      densBtn.type = 'button';
      densBtn.className = 'mc-dens';
      densBtn.setAttribute('aria-label', 'density');

      const bgBtn = document.createElement('button');
      bgBtn.type = 'button';
      bgBtn.className = 'mc-board-bg';
      bgBtn.setAttribute('aria-label', 'board background');
      bgBtn.innerHTML =
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>';


      // 编辑态顶部:返回钮 + 位置条(当前/总数)。默认隐藏,只在编辑态显示。
      const backBtn = document.createElement('button');
      backBtn.type = 'button';
      backBtn.className = 'mc-back';
      backBtn.setAttribute('aria-label', 'exit edit');
      backBtn.style.display = 'none';
      backBtn.innerHTML =
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>';

      // 位置条(#304 Task14):章节 chips + 当前/总数,顶栏正下方,浏览/编辑两态都可见。
      // 取代原先仅编辑态浮层显示的页码(mc-folio)—— 统一成一条位置带,不重复造页码。
      // 章节 chips 从 ctx.chapters() 渲(现有 renderRail 的同一份数据);为空时(未加载
      // 草稿/无章节)只显示页码,优雅降级。
      const subbar = document.createElement('div');
      subbar.className = 'mc-subbar';
      const chipsWrap = document.createElement('div');
      chipsWrap.className = 'mc-subbar-chips';
      const folio = document.createElement('div');
      folio.className = 'mc-subbar-folio';
      subbar.appendChild(chipsWrap);
      subbar.appendChild(folio);

      // 编辑态一级栏:背景/图片/文字三格(#304 Task10,覆盖1搁置删除,只三格)。
      // 「背景」直接接现有 openMobileSheet('page');「图片」/「文字」只切高亮态
      // (给页内可编辑图/文字加虚线框 affordance),真正选中/编辑交给现有 surfaceClick
      // (已在 #ovGrid 上委托监听,编辑态整段放行)。
      let pickMode: 'image' | 'text' | null = null;
      const l1 = document.createElement('div');
      l1.className = 'mc-l1';
      l1.style.display = 'none';

      const makeL1Btn = (cls: string, ariaLabel: string, icon: string, label: string) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = cls;
        btn.setAttribute('aria-label', ariaLabel);
        btn.innerHTML = `${icon}<span>${label}</span>`;
        return btn;
      };
      const bgL1Btn = makeL1Btn(
        'mc-l1-bg',
        'page background',
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>',
        '背景',
      );
      const imgL1Btn = makeL1Btn(
        'mc-l1-img',
        'pick image',
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="5" width="13" height="13" rx="2"/><rect x="7" y="8" width="13" height="13" rx="2"/></svg>',
        '图片',
      );
      const textL1Btn = makeL1Btn(
        'mc-l1-text',
        'pick text',
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16M12 6v14"/></svg>',
        '文字',
      );
      l1.appendChild(bgL1Btn);
      l1.appendChild(imgL1Btn);
      l1.appendChild(textL1Btn);

      // AI 气泡:右下角固定,两态同位(浏览态让开缩略条 mc-fab-browse / 编辑态让开
      // 一级栏 mc-fab-edit,纯 CSS bottom offset)。点击展开现有可变高对话面板
      // (ctx.openChat);对话展开时的隐藏交给 CSS(.editor-port:not(.chat-collapsed)
      // .mc-ai-fab{display:none}),这里不做 JS 显隐判断。
      const aiFab = document.createElement('button');
      aiFab.type = 'button';
      aiFab.className = 'mc-ai-fab mc-fab-browse';
      aiFab.setAttribute('aria-label', 'AI chat');
      // 产品 AI 形象是小水母(与 ChatPanel 思考态同一素材),不是自造图标。
      aiFab.innerHTML = '<img class="mc-fab-jelly" src="/jellyfish-icon.png" alt="AI" />';

      ctx.root.appendChild(densBtn);
      ctx.root.appendChild(bgBtn);
      ctx.root.appendChild(backBtn);
      ctx.root.appendChild(subbar);
      ctx.root.appendChild(l1);
      ctx.root.appendChild(aiFab);

      // ── --dock-h 实时记账(参照 ChatPanel.tsx 的 --canvas-inset 维护法):底部住户
      // (编辑态一级栏 mc-l1 / 展开的对话 pane-chat-col,取最大)变化时,量其相对视口底部的实际占用,写进 root 的 --dock-h,book-stage
      // 的 padding-bottom 据它让开(editor-port.css)。用 getBoundingClientRect 而非
      // display 读取可见性 —— display:none 元素的 rect 高度天然是 0,不用另查 computed
      // style。chatColEl 只查一次:EditorBook 与 ChatPanel 是同一 outerRootRef 下的
      // 兄弟子树,挂载时机上两者 DOM 都已提交,可以放心一次性查到。 ──
      const chatColEl = ctx.root.querySelector<HTMLElement>('.pane-chat-col');
      const computeDockH = (): number => {
        const vh = window.innerHeight;
        let maxReach = 0;
        for (const el of [l1, chatColEl]) {
          if (!el) continue;
          const rect = el.getBoundingClientRect();
          if (rect.height <= 0) continue;
          maxReach = Math.max(maxReach, vh - rect.top);
        }
        return Math.max(0, Math.round(maxReach));
      };
      const updateDockH = () => {
        const dockH = computeDockH();
        ctx.root.style.setProperty('--dock-h', `${dockH}px`);
        // 用 Task3 的 canvasVisibleHeight 做非负健康检查(不是死代码,是记账的自证):
        // topbar/subbar 高度按真实 DOM 量,缺省回落到 CSS 里写死的常量。
        const topbarH = ctx.root.querySelector<HTMLElement>('.topbar')?.getBoundingClientRect().height || 56;
        const subbarH = subbar.getBoundingClientRect().height || 38;
        console.assert(
          canvasVisibleHeight(window.innerHeight, topbarH, subbarH, dockH) >= 0,
          'canvasVisibleHeight 不应为负(dock-h 记账异常)',
        );
      };
      const dockRO = new ResizeObserver(updateDockH);
      dockRO.observe(l1);
      if (chatColEl) dockRO.observe(chatColEl);
      // strip/l1 是内联 style.display 切换(ResizeObserver 能兜住,但 class 切换更快一拍);
      // chat-collapsed 是 root 的 class 切换(pane-chat-col 的显隐由 CSS 规则驱动,不是
      // 内联 style,ResizeObserver 对 display:none↔flex 的切换本身也会触发,这里 MutationObserver
      // 是双保险,即时响应,不等一帧)。
      const dockMO = new MutationObserver(updateDockH);
      dockMO.observe(ctx.root, { attributes: true, attributeFilter: ['class'] });

      // resize 防抖重测(#304 Task14):移动态内视口尺寸变化(旋转屏幕/地址栏收起展开等)
      // 重套密度窗口 + 重算 --dock-h。已知限制:跨 767 边界的桌面↔移动态实时切换本任务不做
      // (initMobileCanvas 只在挂载那一刻按 ctx.getWidth() 判一次态;真要响应需要上层在
      // resize 时重新挂载/卸载整个移动画板,手机上横竖屏不会跨越这个断点,极少发生,
      // 需要时刷新页面即可)。
      let resizeTimer: ReturnType<typeof setTimeout> | null = null;
      const onWindowResize = () => {
        if (resizeTimer !== null) clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
          resizeTimer = null;
          applyWindow();
          updateDockH();
        }, 120);
      };
      window.addEventListener('resize', onWindowResize);

      // 应用当前(density,startIdx)到已渲染好的 #ovGrid 格子:哪些 .ov-page 显示,
      // 哪些隐藏。不改 renderOverview 本身,只在它渲完之后叠一层可见性。用
      // MutationObserver 兜底 —— 别处(patch 应用/加章节/图片解析完成等)也会独立调
      // renderOverview() 重建 innerHTML,那些调用不知道浏览态密度,格子会被冲刷成
      // 全部可见;观察 #ovGrid 子树变化,每次重建后自动重新套用当前窗口,不用到处
      // 找调用点插桩。
      // 图片/文字高亮 affordance:只在编辑态、且一级栏「图片」或「文字」被点亮时生效。
      // 只加/去 .mc-pickable 虚线框类,不拦截任何点击 —— 真正选中/编辑交给现有
      // surfaceClick(编辑态整段放行,已在 #ovGrid 委托监听)。格子会被 renderOverview
      // 整块重建 innerHTML(切页/patch 应用等),所以每次 applyWindow 后都要重套一遍,
      // 不能只在点一级栏那一刻套一次。
      const applyPickHighlight = () => {
        ovBoard.querySelectorAll<HTMLElement>('.mc-pickable').forEach((el) => {
          el.classList.remove('mc-pickable');
        });
        imgL1Btn.classList.toggle('mc-l1-active', pickMode === 'image');
        textL1Btn.classList.toggle('mc-l1-active', pickMode === 'text');
        if (state !== 'edit' || pickMode === null) return;
        const selector = pickMode === 'image' ? '.ov-page img[data-editable]' : '.ov-page [data-editable]:not(img)';
        ovBoard.querySelectorAll<HTMLElement>(selector).forEach((el) => {
          el.classList.add('mc-pickable');
        });
      };

      const applyWindow = () => {
        const total = ctx.totalPages();
        // 编辑态:只显示正在编辑的那一页,宿主格子撑满(mc-edit-fill)。独立分支,
        // 不复用浏览窗口逻辑 —— 避免 MutationObserver 在编辑态里把可见性冲回浏览窗口。
        if (state === 'edit' && editPageIndex !== null) {
          ovBoard.setAttribute('data-mobile-density', '1');
          ovGrid.querySelectorAll<HTMLElement>('.ov-spread').forEach((spreadEl) => {
            let match = false;
            spreadEl.querySelectorAll<HTMLElement>('.ov-page').forEach((pageEl) => {
              const piStr = pageEl.dataset.pageIndex;
              const pi = piStr === undefined || piStr === '' ? null : Number(piStr);
              const show = pi !== null && pi === editPageIndex;
              pageEl.style.display = show ? '' : 'none';
              pageEl.classList.toggle('mc-edit-fill', show);
              if (show) match = true;
            });
            spreadEl.style.display = match ? '' : 'none';
          });
          applyPickHighlight();
          return;
        }
        // 浏览态 = 固定预览,按【开页(spread)】为单位显示,不滚不拖:
        //   密度 1 → 单页(当前 startIdx 那一页,同 spread 的另一页藏掉)
        //   密度 2 → 一个开页(startIdx 所在 .ov-spread 的左右两页)
        //   密度 4 → 两个开页(该 spread + 下一个 spread)
        // 用 .ov-spread DOM 顺序(buildSpreads 的真实开页,封面/结尾独页天然处理),
        // 不用按页数机械切 —— 那样 2 页可能横跨两个开页,不是自然的左右对页。
        startIdx = clampStart(startIdx, 1, total); // 页游标本身合法即可(开页对齐在下面按 DOM 做)
        ovBoard.setAttribute('data-mobile-density', String(density));
        const spreadEls = Array.from(ovGrid.querySelectorAll<HTMLElement>('.ov-spread'));
        const pageInSpread = (sp: HTMLElement, pi: number) =>
          Array.from(sp.querySelectorAll<HTMLElement>('.ov-page')).some((pg) => {
            const s = pg.dataset.pageIndex;
            return s !== undefined && s !== '' && Number(s) === pi;
          });
        let firstSpread = spreadEls.findIndex((sp) => pageInSpread(sp, startIdx));
        if (firstSpread < 0) firstSpread = 0;
        const spreadCount = density === 4 ? 2 : 1; // 1/2 → 一个开页格;4 → 两个开页格
        spreadEls.forEach((spreadEl, si) => {
          const inWindow = si >= firstSpread && si < firstSpread + spreadCount;
          spreadEl.querySelectorAll<HTMLElement>('.ov-page').forEach((pageEl) => {
            const piStr = pageEl.dataset.pageIndex;
            const pi = piStr === undefined || piStr === '' ? null : Number(piStr);
            // 密度 1:开页内只留 startIdx 那一页(单页预览);2/4:整开页左右都留。
            const show = inWindow && (density !== 1 || pi === startIdx);
            pageEl.style.display = show ? '' : 'none';
            pageEl.classList.remove('mc-edit-fill'); // 离开编辑态兜底清掉撑满类
          });
          spreadEl.style.display = inWindow ? '' : 'none';
        });
      };


      // 位置条渲染:页码用当前正在看的那一页(编辑态=editPageIndex,浏览态=当前屏起始页)。
      // 章节 chips 高亮用 ctx.spreadOfPage(currentPage) 换算成章节的 spread 单位 ——
      // 精确映射(EditorPort 挂载点接的是桌面同款 spreadIndexOfPage(spreads, i)),
      // 不再用 floor(page/2) 近似,封面/结尾独页处不会漂移(#304 Important fix1)。
      // chapters 为空(未加载/无草稿)时只显示页码,chips 容器隐藏,优雅降级。
      const renderSubbar = () => {
        const total = ctx.totalPages();
        const currentPage = state === 'edit' && editPageIndex !== null ? editPageIndex : startIdx;
        folio.textContent = total > 0 ? `${currentPage + 1} / ${total}` : '';

        const chs = ctx.chapters();
        if (chs.length === 0) {
          chipsWrap.style.display = 'none';
          chipsWrap.innerHTML = '';
          return;
        }
        chipsWrap.style.display = '';
        const currentSpread = ctx.spreadOfPage(currentPage);
        let activeIdx = 0;
        chs.forEach((c, i) => { if (c.spread <= currentSpread) activeIdx = i; });
        chipsWrap.innerHTML = '';
        chs.forEach((c, i) => {
          const chip = document.createElement('span');
          chip.className = 'mc-chip' + (i === activeIdx ? ' on' : '');
          chip.textContent = c.label;
          chipsWrap.appendChild(chip);
        });
      };
      // editing 模式的 chapters 来自异步 fetch,首帧渲染跑在 resolve 之前 chips 会隐藏;
      // 把外部可调用的刷新钩子指到 renderSubbar,供 EditorPort 的 fetch 成功回调触发
      // (#304 Important fix2)。renderSubbar 本身只读 ctx.chapters()/state 现有闭包变量,
      // 重复调用是幂等的(重算 chip 列表 + 高亮,不产生额外副作用/请求)。
      refreshChapters = renderSubbar;

      const render = () => {
        densBtn.textContent = String(density);
        applyWindow();
        renderSubbar();
      };

      const onDensClick = () => {
        density = cycleDensity(density);
        startIdx = clampStart(startIdx, density, ctx.totalPages());
        render();
      };
      const onBgClick = () => ctx.openBoardBg();

      densBtn.addEventListener('click', onDensClick);
      bgBtn.addEventListener('click', onBgClick);

      // 一级栏三格。「背景」直接接现有 openMobileSheet('page')(经 ctx.openPageBg
      // 传入,零重画)。「图片」/「文字」只切高亮态 —— 再点一次取消,互斥切换。
      const onBgL1Click = () => ctx.openPageBg();
      const onImgL1Click = () => {
        pickMode = pickMode === 'image' ? null : 'image';
        applyPickHighlight();
      };
      const onTextL1Click = () => {
        pickMode = pickMode === 'text' ? null : 'text';
        applyPickHighlight();
      };
      bgL1Btn.addEventListener('click', onBgL1Click);
      imgL1Btn.addEventListener('click', onImgL1Click);
      textL1Btn.addEventListener('click', onTextL1Click);

      const onAiFabClick = () => ctx.openChat();
      aiFab.addEventListener('click', onAiFabClick);

      // 编辑态 chrome:进入时隐藏浏览态的密度/背景钮,露出返回钮 + 位置条 + 一级栏。
      const updateEditChrome = () => {
        const editing = state === 'edit';
        densBtn.style.display = editing ? 'none' : '';
        bgBtn.style.display = editing ? 'none' : '';
        backBtn.style.display = editing ? '' : 'none';
        l1.style.display = editing ? '' : 'none';
        aiFab.classList.toggle('mc-fab-browse', !editing);
        aiFab.classList.toggle('mc-fab-edit', editing);
        // 位置条(mc-subbar)两态都可见,不在这里切显隐;内容(章节高亮/页码)随态更新。
        renderSubbar();
        // strip/l1 的显隐刚在上面翻过 —— 底部住户变了,--dock-h 记账立即跟上
        // (ResizeObserver 也会兜住,这里是即时的那一拍,不等一帧)。
        updateDockH();
      };

      const enterEditPage = (pageIndex: number) => {
        state = 'edit';
        editPageIndex = pageIndex;
        ovBoard.setAttribute('data-mobile-edit', '1');
        ctx.enterEdit(pageIndex);
        ctx.renderGrid(); // 重建格子后立即按 state 重套可见性,拿到新 clientWidth 的重绘路径
        applyWindow();
        updateEditChrome();
      };

      const exitEditMode = () => {
        state = 'browse';
        editPageIndex = null;
        pickMode = null; // 退出编辑态:一级栏「图片」/「文字」高亮态一并清掉
        ovBoard.removeAttribute('data-mobile-edit');
        ctx.exitEdit();
        ctx.renderGrid();
        applyWindow();
        applyPickHighlight();
        updateEditChrome();
      };

      // 到头夹住,不循环 —— 翻页翻到底就停在首/末页。
      const navigatePage = (dir: 1 | -1) => {
        if (editPageIndex === null) return;
        const total = ctx.totalPages();
        const next = Math.max(0, Math.min(total - 1, editPageIndex + dir));
        if (next === editPageIndex) return;
        enterEditPage(next);
      };

      // 浏览态换屏(固定预览,按开页翻):
      //   密度 1 → 逐页翻(startIdx ±1),每页单独看。
      //   密度 2 → 翻一个开页;密度 4 → 翻两个开页 —— 用 .ov-spread DOM 顺序移动游标,
      //   到头夹住不循环。左滑(dir=1)=下,右滑(dir=-1)=上。
      const firstPageOfSpread = (sp: HTMLElement): number | null => {
        for (const pg of Array.from(sp.querySelectorAll<HTMLElement>('.ov-page'))) {
          const s = pg.dataset.pageIndex;
          if (s !== undefined && s !== '') return Number(s);
        }
        return null;
      };
      const navigateScreen = (dir: 1 | -1) => {
        const total = ctx.totalPages();
        if (density === 1) {
          const next = Math.max(0, Math.min(total - 1, startIdx + dir));
          if (next === startIdx) return;
          startIdx = next;
          render();
          return;
        }
        const spreadEls = Array.from(ovGrid.querySelectorAll<HTMLElement>('.ov-spread'));
        let cur = spreadEls.findIndex((sp) =>
          Array.from(sp.querySelectorAll<HTMLElement>('.ov-page')).some((pg) => {
            const s = pg.dataset.pageIndex;
            return s !== undefined && s !== '' && Number(s) === startIdx;
          }),
        );
        if (cur < 0) cur = 0;
        const step = density === 4 ? 2 : 1; // 4 档一次翻两个开页
        const nextSpread = Math.max(0, Math.min(spreadEls.length - 1, cur + dir * step));
        if (nextSpread === cur) return;
        const fp = spreadEls[nextSpread] ? firstPageOfSpread(spreadEls[nextSpread]!) : null;
        if (fp === null) return;
        startIdx = fp;
        render();
      };

      // 浏览态点格子进编辑态(满屏)。捕获阶段抢在 EditorPort 的 surfaceClick(冒泡,
      // 同样绑在 #ovGrid 上)之前跑:命中页格子时 stopImmediatePropagation 掐断本次
      // 事件的后续传播,surfaceClick 就不会再执行 → 不会走 onPageSelect →
      // showElementToolbar → openMobileSheet 弹出「书页背景」sheet。#ovGrid 是被点
      // 内容(.ov-page 及其子孙)的祖先而非事件目标本身,所以捕获阶段严格先于冒泡阶段
      // 抵达同一元素,这里能真正抢占。编辑态(state==='edit')整段直接放行,不做任何
      // 拦截,surfaceClick 冒泡照常跑(Task10 选图/选文字要用)。
      const onOvGridEditClick = (e: Event) => {
        if (state !== 'browse') return;
        const target = e.target as HTMLElement | null;
        const pageEl = target?.closest<HTMLElement>('.ov-page[data-page-index]:not(.ov-empty)');
        if (!pageEl) return;
        const piStr = pageEl.dataset.pageIndex;
        if (piStr === undefined || piStr === '') return;
        e.stopImmediatePropagation();
        enterEditPage(Number(piStr));
      };
      ovGrid.addEventListener('click', onOvGridEditClick, true);

      const onBackClick = () => exitEditMode();
      backBtn.addEventListener('click', onBackClick);

      // 两态共用手势:pointers 数 + 主轴 + 是否落在已选中图(现有 img-editing 标记)→
      // arbitrateGesture 裁决。左缘 20px 按下让给系统返回,不接管(两态都适用,down 阶段
      // 不分态)。浏览态:单指横滑=换屏(navigateScreen,等同点缩略条相邻屏),双指捏合=
      // 切 1/2/4 密度(等同点左下角数字钮)。编辑态:单指横滑=翻页(navigatePage)、
      // 竖滑=滚页、已选中图上拖=改构图,行为不变;编辑态双指捏合放大【本次搁置,见
      // DESIGN 手势契约表】,arbitrateGesture 判为 owner==='zoom' 时不接管。
      const activePointers = new Map<number, { x: number; y: number }>();
      const AXIS_LOCK_PX = 8;
      const SWIPE_COMMIT_PX = 40;
      const PINCH_COMMIT_PX = 40; // 双指距离变化超此阈值才切一档密度
      const LEFT_EDGE_PX = 20;
      let gestureStart: { x: number; y: number } | null = null;
      let gestureAxis: 'x' | 'y' | null = null;
      let gestureOwner: GestureOwner | null = null;
      let gestureEdge = false;
      let pinchStartDist: number | null = null;
      let pinchConsumed = false; // 一次捏合只切一档:触发后置位,手势重置(pointerup/cancel)前忽略后续移动

      const resetGesture = () => {
        gestureStart = null;
        gestureAxis = null;
        gestureOwner = null;
        gestureEdge = false;
        pinchStartDist = null;
        pinchConsumed = false;
      };

      const pointerDistance = (): number | null => {
        const pts = Array.from(activePointers.values());
        if (pts.length < 2) return null;
        const [a, b] = pts;
        return Math.hypot(a.x - b.x, a.y - b.y);
      };

      const onEditPointerDown = (e: PointerEvent) => {
        activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (activePointers.size === 1) {
          gestureStart = { x: e.clientX, y: e.clientY };
          gestureAxis = null;
          gestureOwner = null;
          gestureEdge = e.clientX <= LEFT_EDGE_PX;
        } else if (activePointers.size === 2) {
          // 第二指落下:记捏合基线(浏览态用于切密度;编辑态捏合放大本次搁置,不使用)。
          pinchStartDist = pointerDistance();
          pinchConsumed = false;
        }
      };
      const onEditPointerMove = (e: PointerEvent) => {
        if (!activePointers.has(e.pointerId)) return;
        activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

        if (activePointers.size >= 2) {
          // 双指:浏览态捏合切密度;编辑态捏合放大本次搁置不接管(owner==='zoom' 时
          // 什么都不做,原生默认行为不拦截,松手也不触发任何切态)。
          if (state === 'browse') {
            const dist = pointerDistance();
            if (dist !== null) {
              if (pinchStartDist === null) {
                pinchStartDist = dist;
              } else if (!pinchConsumed) {
                const delta = Math.abs(dist - pinchStartDist);
                if (delta >= PINCH_COMMIT_PX) {
                  const owner = arbitrateGesture({ state, pointers: 2, axis: null, onSelectedImage: false });
                  if (owner === 'density') {
                    density = cycleDensity(density);
                    startIdx = clampStart(startIdx, density, ctx.totalPages());
                    render();
                    pinchConsumed = true; // 防连切:同一次捏合手势内不再触发第二档
                  }
                }
              }
              e.preventDefault();
            }
          }
          return;
        }

        if (gestureEdge || !gestureStart) return; // 让给系统边缘返回手势
        const dx = e.clientX - gestureStart.x;
        const dy = e.clientY - gestureStart.y;
        if (gestureAxis === null) {
          if (Math.abs(dx) < AXIS_LOCK_PX && Math.abs(dy) < AXIS_LOCK_PX) return;
          gestureAxis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
        }
        const onSelectedImage = !!(e.target as HTMLElement | null)?.closest?.('.img-editing');
        gestureOwner = arbitrateGesture({ state, pointers: 1, axis: gestureAxis, onSelectedImage });
        // page-nav / none 都不该让容器跟着手指晃(容器本身不滚不拖);scroll-page 放行
        // 原生滚动,pan-image 交给现有构图逻辑(Task 10),都不拦截。
        if (gestureOwner === 'page-nav' || gestureOwner === 'none') e.preventDefault();
      };
      const onEditPointerUp = (e: PointerEvent) => {
        const start = gestureStart;
        const wasEdge = gestureEdge;
        const owner = gestureOwner;
        const dxFinal = start ? e.clientX - start.x : 0;
        activePointers.delete(e.pointerId);
        if (activePointers.size === 0) {
          if (!wasEdge && owner === 'page-nav' && Math.abs(dxFinal) >= SWIPE_COMMIT_PX) {
            const dir: 1 | -1 = dxFinal < 0 ? 1 : -1;
            if (state === 'edit') {
              navigatePage(dir);
            } else if (state === 'browse') {
              navigateScreen(dir);
            }
          }
          resetGesture();
        }
      };
      const onEditPointerCancel = () => {
        activePointers.clear();
        resetGesture();
      };
      ovBoard.addEventListener('pointerdown', onEditPointerDown);
      ovBoard.addEventListener('pointermove', onEditPointerMove, { passive: false });
      ovBoard.addEventListener('pointerup', onEditPointerUp);
      ovBoard.addEventListener('pointercancel', onEditPointerCancel);

      const gridObserver = new MutationObserver(() => applyWindow());
      gridObserver.observe(ovGrid, { childList: true });

      render();
      updateEditChrome(); // 内部会调 renderSubbar() + updateDockH(),挂载时的初次记账在这里完成

      // teardown 必须移除 chat-collapsed:卸载/切态(编辑期→创作期、移动→桌面)时
      // 不留脏类,否则会误伞创作期或桌面对话默认展开的既有行为。
      cleanups.push(() => ctx.root.classList.remove('chat-collapsed'));

      cleanups.push(() => {
        window.removeEventListener('resize', onWindowResize);
        if (resizeTimer !== null) clearTimeout(resizeTimer);
      });

      cleanups.push(() => {
        densBtn.removeEventListener('click', onDensClick);
        bgBtn.removeEventListener('click', onBgClick);
        bgL1Btn.removeEventListener('click', onBgL1Click);
        imgL1Btn.removeEventListener('click', onImgL1Click);
        textL1Btn.removeEventListener('click', onTextL1Click);
        aiFab.removeEventListener('click', onAiFabClick);
        ovGrid.removeEventListener('click', onOvGridEditClick, true);
        backBtn.removeEventListener('click', onBackClick);
        ovBoard.removeEventListener('pointerdown', onEditPointerDown);
        ovBoard.removeEventListener('pointermove', onEditPointerMove);
        ovBoard.removeEventListener('pointerup', onEditPointerUp);
        ovBoard.removeEventListener('pointercancel', onEditPointerCancel);
        gridObserver.disconnect();
        dockRO.disconnect();
        dockMO.disconnect();
        ctx.root.style.removeProperty('--dock-h');
        ovBoard.removeAttribute('data-mobile-edit');
        densBtn.remove();
        bgBtn.remove();
        backBtn.remove();
        subbar.remove();
        l1.remove();
        aiFab.remove();
      });
    }
  }

  return {
    teardown: () => { for (const c of cleanups) c(); },
    refreshChapters: () => refreshChapters(),
  };
}
