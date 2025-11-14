import "./index.css";

type Task = {
  label: string;
  subtasks?: Task[];
};

type LayoutRange = [number, number];
type Viewport = { width: number; height: number; dpr: number };
type TaskState = "default" | "completed" | "cancelled";
type ActionType = "cancel" | "complete" | "add" | "restore" | "delete";
type Position = { x: number; y: number };

const FONT = "16px 'Inter', system-ui";
const NODE_WIDTH = 220;
const NODE_HEIGHT = 48;
const NODE_RADIUS = 12;
const NODE_PADDING_X = 16;
const LEVEL_GAP_MIN = 280;
const LEVEL_GAP_MAX = 360;
const LEVEL_GAP_VIEW_RATIO = 0.9;
const ZOOM_MIN = 0.4;
const ZOOM_MAX = 2.5;
const ZOOM_SENSITIVITY = 0.0015;
const CHILD_PADDING = 0;
const NODE_VERTICAL_MARGIN = 24;
const NODE_VERTICAL_SPACING = 60;
const PROGRESS_BAR_HEIGHT = 6;
const PROGRESS_BAR_MARGIN_X = 0;
const PROGRESS_BAR_OFFSET_Y = 0;
const CONNECTOR_COLOR = "rgba(148, 163, 184, 0.5)";
const BACKGROUND_COLOR = "#ffffff";
const BACKGROUND_GRID_COLOR = "rgba(148, 163, 184, 0.35)";
const BACKGROUND_GRID_SIZE = 80;
const LAYOUT_ANIMATION_DURATION = 350;
const NODE_COLORS = {
  default: {
    fill: "#ffffff",
    strokeBranch: "#d4d4d8",
    strokeLeaf: "#d4d4d8",
    text: "#0f172a",
  },
  completed: {
    fill: "#22c55e",
    stroke: "#16a34a",
    text: "#0f172a",
  },
  cancelled: {
    fill: "#e5e7eb",
    stroke: "#94a3b8",
    text: "#475569",
  },
};
const ACTION_DEFINITIONS: Record<ActionType, { color: string; activeColor: string }> = {
  cancel: { color: "#94a3b8", activeColor: "#64748b" },
  complete: { color: "#86efac", activeColor: "#22c55e" },
  add: { color: "#fde68a", activeColor: "#fbbf24" },
  restore: { color: "#c7d2fe", activeColor: "#818cf8" },
  delete: { color: "#fecaca", activeColor: "#f87171" },
};
const ACTION_ICON_BASE_SIZE = 20;
const ACTION_ICON_COLOR = "#0f172a";
const OVERLAY_BORDER_COLOR = "rgba(15, 23, 42, 0.2)";
let leafCounts = new WeakMap<Task, number>();

function getLeafCount(task: Task): number {
  const cached = leafCounts.get(task);
  if (cached !== undefined) return cached;
  const subtasks = task.subtasks ?? [];
  const leaves = subtasks.length
    ? subtasks.reduce((sum, child) => sum + getLeafCount(child), 0)
    : 1;
  leafCounts.set(task, leaves);
  return leaves;
}

function computeLayoutHeight(task: Task): number {
  const leaves = Math.max(getLeafCount(task), 1);
  return leaves * (NODE_HEIGHT + NODE_VERTICAL_SPACING);
}

const rootTask: Task = {
  label: "Base",
  subtasks: [
    {
      label: "EECS MEng",
      subtasks: [
        {
          label: "NORAM scholarship",
          subtasks: [
            {
              label: "Recommendation letters",
              subtasks: [
                { label: "Rec letter 1" },
                { label: "Rec letter 2" },
                { label: "Rec letter 3" },
              ],
            },
            { label: "Application letter" },
          ],
        },
      ],
    },
  ],
};

const { canvas, ctx } = initCanvas();
let viewport = configureCanvas(canvas, ctx);
const initialDepth = maxDepth(rootTask);
let levelGap = computeLevelGap(initialDepth, viewport.width);
let layoutHeight = computeLayoutHeight(rootTask);
let panX = viewport.width / 2 - ((initialDepth * levelGap + NODE_WIDTH) / 2);
let panY = viewport.height / 2 - layoutHeight / 2;
let zoom = 1;
let hoveredNode: NodeHitbox | null = null;
let hoveredAction: ActionType | null = null;
let nodeHitboxes: NodeHitbox[] = [];
const displayPositions = new Map<Task, Position>();
let pendingNodes: PendingNode[] = [];
const taskStates = new WeakMap<Task, TaskState>();
let layoutAnimationStartTime = 0;
let layoutAnimationStartPositions: Map<Task, Position> | null = null;
let layoutAnimationProgress = 1;
let animationFrameHandle: number | null = null;
let editingTask: Task | null = null;
let editingParentForRemoval: Task | null = null;
let editingInitialLabel = "";
let editingInput: HTMLInputElement | null = null;
let pendingEditTask: Task | null = null;
let pendingEditParent: Task | null = null;
const ROOT_ADD_BUTTON_ID = "add-root-task-button";

setupPanHandlers(canvas);
setupZoomHandler(canvas);
window.addEventListener("resize", () => {
  viewport = configureCanvas(canvas, ctx);
  render();
});
setupAddRootChildButton();

render();

function render(timestamp: number = performance.now()) {
  updateLayoutAnimationState(timestamp);
  leafCounts = new WeakMap();
  const treeDepth = maxDepth(rootTask);
  levelGap = computeLevelGap(treeDepth, viewport.width);
  layoutHeight = computeLayoutHeight(rootTask);
  nodeHitboxes = [];
  displayPositions.clear();
  pendingNodes = [];
  ctx.clearRect(0, 0, viewport.width, viewport.height);
  fillBackground(viewport, panX, panY, zoom);
  ctx.save();
  ctx.translate(panX, panY);
  ctx.scale(zoom, zoom);
  drawTree(rootTask, layoutHeight);
  drawPendingNodes();
  ctx.restore();
  if (pendingEditTask) {
    startEditingTask(pendingEditTask, pendingEditParent ?? null);
    pendingEditTask = null;
    pendingEditParent = null;
  } else {
    positionEditingInput();
  }
}

function initCanvas() {
  const canvas = document.querySelector("canvas");
  if (!canvas) throw new Error("Could not find canvas");

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not get context");

  return { canvas, ctx };
}

function configureCanvas(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D): Viewport {
  const dpr = window.devicePixelRatio || 1;
  const width = window.innerWidth;
  const height = window.innerHeight;

  canvas.style.touchAction = "none";
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  canvas.width = width * dpr;
  canvas.height = height * dpr;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr, dpr);
  ctx.font = FONT;
  ctx.textBaseline = "middle";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  return { width, height, dpr };
}

function setupPanHandlers(canvas: HTMLCanvasElement) {
  let isDragging = false;
  let dragStartX = 0;
  let dragStartY = 0;

  canvas.style.cursor = "grab";

  const updateHoverState = (event: PointerEvent) => {
    if (isDragging) return;
    const { worldX, worldY } = getWorldCoordinates(canvas, event);
    const hitNode = hitTestNode(worldX, worldY);
    hoveredNode = hitNode;
    if (hitNode) {
      hoveredAction = getActionFromPosition(hitNode, worldX);
    } else {
      hoveredAction = null;
    }
    render();
  };

  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    if (editingInput && editingTask) {
      editingInput.blur();
    }
    updateHoverState(event);
    if (hoveredNode && hoveredAction) {
      handleAction(hoveredAction, hoveredNode);
      hoveredAction = null;
      event.preventDefault();
      return;
    }

    isDragging = true;
    dragStartX = event.clientX - panX;
    dragStartY = event.clientY - panY;
    canvas.setPointerCapture(event.pointerId);
    canvas.style.cursor = "grabbing";
    event.preventDefault();
  });

  canvas.addEventListener("pointermove", (event) => {
    if (isDragging) {
      panX = event.clientX - dragStartX;
      panY = event.clientY - dragStartY;
      render();
      event.preventDefault();
      return;
    }
    updateHoverState(event);
  });

  const endDrag = (event: PointerEvent) => {
    if (!isDragging) return;
    isDragging = false;
    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
    canvas.style.cursor = "grab";
    updateHoverState(event);
  };

  ["pointerup", "pointerleave", "pointercancel"].forEach((type) => {
    canvas.addEventListener(type, (event) => {
      if (type !== "pointerup") {
        hoveredNode = null;
        hoveredAction = null;
        render();
      }
      endDrag(event as PointerEvent);
    });
  });
}

function setupZoomHandler(canvas: HTMLCanvasElement) {
  canvas.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const canvasX = event.clientX - rect.left;
      const canvasY = event.clientY - rect.top;
      const zoomDelta = Math.exp(-event.deltaY * ZOOM_SENSITIVITY);
      const newZoom = clamp(zoom * zoomDelta, ZOOM_MIN, ZOOM_MAX);
      if (newZoom === zoom) return;
      const worldX = (canvasX - panX) / zoom;
      const worldY = (canvasY - panY) / zoom;
      zoom = newZoom;
      panX = canvasX - worldX * zoom;
      panY = canvasY - worldY * zoom;
      render();
    },
    { passive: false }
  );
}

function setupAddRootChildButton() {
  if (document.getElementById(ROOT_ADD_BUTTON_ID)) return;
  const button = document.createElement("button");
  button.id = ROOT_ADD_BUTTON_ID;
  button.type = "button";
  button.textContent = "+";
  button.style.position = "fixed";
  button.style.bottom = "24px";
  button.style.right = "24px";
  button.style.width = "56px";
  button.style.height = "56px";
  button.style.borderRadius = "50%";
  button.style.border = "none";
  button.style.background = "linear-gradient(135deg, #2563eb, #7c3aed)";
  button.style.color = "#ffffff";
  button.style.fontSize = "32px";
  button.style.fontWeight = "600";
  button.style.cursor = "pointer";
  button.style.boxShadow = "0 12px 24px rgba(37, 99, 235, 0.3)";
  button.style.display = "flex";
  button.style.alignItems = "center";
  button.style.justifyContent = "center";
  button.style.transition = "transform 0.15s ease, box-shadow 0.15s ease";
  button.addEventListener("pointerdown", (event) => event.stopPropagation());
  button.addEventListener("click", () => {
    if (!rootTask.subtasks) rootTask.subtasks = [];
    const newTask: Task = { label: "" };
    rootTask.subtasks.push(newTask);
    pendingEditTask = newTask;
    pendingEditParent = rootTask;
    render();
  });
  button.addEventListener("pointerenter", () => {
    button.style.transform = "scale(1.05)";
    button.style.boxShadow = "0 16px 32px rgba(37, 99, 235, 0.35)";
  });
  button.addEventListener("pointerleave", () => {
    button.style.transform = "scale(1)";
    button.style.boxShadow = "0 12px 24px rgba(37, 99, 235, 0.3)";
  });
  document.body.appendChild(button);
}

function fillBackground(
  viewport: { width: number; height: number },
  panX: number,
  panY: number,
  zoom: number
) {
  ctx.fillStyle = BACKGROUND_COLOR;
  ctx.fillRect(0, 0, viewport.width, viewport.height);

  ctx.strokeStyle = BACKGROUND_GRID_COLOR;
  ctx.lineWidth = 1;
  const sizeWorld = BACKGROUND_GRID_SIZE;
  const worldMinX = (-panX) / zoom - sizeWorld;
  const worldMaxX = (viewport.width - panX) / zoom + sizeWorld;
  const worldMinY = (-panY) / zoom - sizeWorld;
  const worldMaxY = (viewport.height - panY) / zoom + sizeWorld;

  const startX = Math.floor(worldMinX / sizeWorld) * sizeWorld;
  const startY = Math.floor(worldMinY / sizeWorld) * sizeWorld;

  ctx.beginPath();
  for (let x = startX; x < worldMaxX; x += sizeWorld) {
    const screenX = panX + zoom * x;
    ctx.moveTo(screenX, 0);
    ctx.lineTo(screenX, viewport.height);
  }
  for (let y = startY; y < worldMaxY; y += sizeWorld) {
    const screenY = panY + zoom * y;
    ctx.moveTo(0, screenY);
    ctx.lineTo(viewport.width, screenY);
  }
  ctx.stroke();
}

function maxDepth(task: Task, level = 0): number {
  const childDepths = (task.subtasks ?? []).map((child) =>
    maxDepth(child, level + 1)
  );
  return Math.max(level, ...childDepths);
}

function computeLevelGap(depth: number, viewportWidth: number): number {
  if (depth <= 0) return LEVEL_GAP_MAX;
  const usableWidth = Math.max(viewportWidth * LEVEL_GAP_VIEW_RATIO - NODE_WIDTH, LEVEL_GAP_MIN);
  const gap = usableWidth / Math.max(depth, 1);
  return clamp(gap, LEVEL_GAP_MIN, LEVEL_GAP_MAX);
}

function drawTree(task: Task, layoutHeightValue: number) {
  drawTask(task, [0, 1], 0, layoutHeightValue, maxDepth(task), null, false, false);
}

function drawTask(
  task: Task,
  range: LayoutRange = [0, 1],
  level = 0,
  layoutHeightValue: number = computeLayoutHeight(task),
  taskDepth: number = maxDepth(task, level),
  parent: Task | null = null,
  renderNode = true,
  connectChildren = true
) {
  const [start, end] = range;
  const y = layoutHeightValue * ((start + end) / 2);
  const x = (taskDepth - level) * levelGap;

  const subtasks = task.subtasks ?? [];
  const { x: displayX, y: displayY } = getAnimatedPosition(task, x, y);
  if (renderNode) {
    const progress = subtasks.length
      ? {
          completed: subtasks.filter((child) => (taskStates.get(child) ?? "default") === "completed").length,
          total: subtasks.length,
        }
      : undefined;
    pendingNodes.push({
      task,
      x: displayX,
      y: displayY,
      hasChildren: subtasks.length > 0,
      parent,
      progress,
    });
  }
  displayPositions.set(task, { x: displayX, y: displayY });

  if (!subtasks.length) return;

  const totalLeaves =
    subtasks.reduce((sum, child) => sum + getLeafCount(child), 0) || subtasks.length;
  let offset = start;
  const span = end - start;

  subtasks.forEach((subtask) => {
    const weight = (getLeafCount(subtask) / totalLeaves) || (1 / subtasks.length);
    const childSpan = span * weight;
    const childStart = offset;
    const childEnd = childStart + childSpan;
    const desiredPaddingInRange = NODE_VERTICAL_MARGIN / layoutHeightValue;
    const padding = Math.min(childSpan / 2 - 1e-4, desiredPaddingInRange);
    const childDepth = maxDepth(subtask, level + 1);
    const childX = (childDepth - (level + 1)) * levelGap;
    const childY = layoutHeightValue * ((childStart + childEnd) / 2);

    drawTask(
      subtask,
      [childStart + padding, childEnd - padding],
      level + 1,
      layoutHeightValue,
      childDepth,
      task
    );

    const childDisplay = displayPositions.get(subtask);
    if (childDisplay && connectChildren && renderNode) {
      drawConnector(
        childDisplay.x + NODE_WIDTH,
        childDisplay.y,
        displayX,
        displayY
      );
    }
    offset += childSpan;
  });
}

type NodeProgress = { completed: number; total: number };
type PendingNode = {
  task: Task;
  x: number;
  y: number;
  hasChildren: boolean;
  parent: Task | null;
  progress?: NodeProgress;
};

function drawNode(task: Task, x: number, centerY: number, hasChildren: boolean, progress?: NodeProgress) {
  const label = task.label;
  const state = taskStates.get(task) ?? "default";
  const top = centerY - NODE_HEIGHT / 2;
  const colorSet =
    state === "completed"
      ? NODE_COLORS.completed
      : state === "cancelled"
      ? NODE_COLORS.cancelled
      : NODE_COLORS.default;

  roundRect(x, top, NODE_WIDTH, NODE_HEIGHT, NODE_RADIUS);

  ctx.fillStyle = colorSet.fill;
  ctx.fill();

  if (progress && progress.total > 0) {
    const ratio = Math.min(progress.completed / progress.total, 1);
    drawProgressBar(x, top, NODE_WIDTH, PROGRESS_BAR_HEIGHT, ratio);
  }

  let strokeColor;
  if (state === "completed") {
    strokeColor = NODE_COLORS.completed.stroke;
  } else if (state === "cancelled") {
    strokeColor = NODE_COLORS.cancelled.stroke;
  } else {
    strokeColor = hasChildren ? NODE_COLORS.default.strokeBranch : NODE_COLORS.default.strokeLeaf;
  }
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = 2;
  ctx.stroke();

  const textColor =
    state === "completed"
      ? NODE_COLORS.completed.text
      : state === "cancelled"
      ? NODE_COLORS.cancelled.text
      : NODE_COLORS.default.text;
  ctx.fillStyle = textColor;
  ctx.fillText(label, x + NODE_PADDING_X, centerY);

  if (hoveredNode?.task === task) {
    drawActionOverlay(task, x, top, NODE_WIDTH, NODE_HEIGHT, hoveredAction);
  }
}

function roundRect(x: number, y: number, width: number, height: number, radius: number) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function drawConnector(fromX: number, fromY: number, toX: number, toY: number) {
  ctx.strokeStyle = CONNECTOR_COLOR;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(fromX, fromY);
  ctx.bezierCurveTo(
    (fromX + toX) / 2,
    fromY,
    (fromX + toX) / 2,
    toY,
    toX,
    toY
  );
  ctx.stroke();
}

function getAnimatedPosition(task: Task, targetX: number, targetY: number): Position {
  if (!layoutAnimationStartPositions) {
    return { x: targetX, y: targetY };
  }
  const start = layoutAnimationStartPositions.get(task);
  if (!start) {
    return { x: targetX, y: targetY };
  }
  const t = layoutAnimationProgress;
  return {
    x: lerp(start.x, targetX, t),
    y: lerp(start.y, targetY, t),
  };
}

type NodeHitbox = {
  task: Task;
  parent: Task | null;
  x: number;
  y: number;
  width: number;
  height: number;
};

function getWorldCoordinates(canvas: HTMLCanvasElement, event: PointerEvent) {
  const rect = canvas.getBoundingClientRect();
  const canvasX = event.clientX - rect.left;
  const canvasY = event.clientY - rect.top;
  return { worldX: (canvasX - panX) / zoom, worldY: (canvasY - panY) / zoom };
}

function hitTestNode(worldX: number, worldY: number): NodeHitbox | null {
  for (let i = nodeHitboxes.length - 1; i >= 0; i -= 1) {
    const node = nodeHitboxes[i];
    if (
      worldX >= node.x &&
      worldX <= node.x + node.width &&
      worldY >= node.y &&
      worldY <= node.y + node.height
    ) {
      return node;
    }
  }
  return null;
}

function getActionFromPosition(node: NodeHitbox, worldX: number): ActionType | null {
  const actions = getActionsForTask(node.task);
  if (!actions.length) return null;
  const relativeX = worldX - node.x;
  if (relativeX < 0 || relativeX > NODE_WIDTH) return null;
  const segmentWidth = NODE_WIDTH / actions.length;
  const index = Math.min(actions.length - 1, Math.floor(relativeX / segmentWidth));
  return actions[index] ?? null;
}

function getActionsForTask(task: Task): ActionType[] {
  const state = taskStates.get(task) ?? "default";
  if (state === "cancelled") {
    return ["delete", "restore"];
  }
  return ["cancel", "complete", "add"];
}

function handleAction(action: ActionType, node: NodeHitbox) {
  const task = node.task;
  const shouldAnimateLayout = action === "add" || action === "delete";
  const previousPositions = shouldAnimateLayout ? captureDisplayPositions() : null;
  if (action === "cancel") {
    if (taskStates.get(task) === "cancelled") {
      clearTaskStateRecursive(task);
    } else {
      setTaskStateRecursive(task, "cancelled");
    }
  } else if (action === "complete") {
    if (taskStates.get(task) === "completed") {
      taskStates.delete(task);
    } else {
      taskStates.set(task, "completed");
    }
  } else if (action === "add") {
    if (!task.subtasks) {
      task.subtasks = [];
    }
    const newTask: Task = {
      label: "",
    };
    task.subtasks.push(newTask);
    taskStates.delete(task);
    pendingEditTask = newTask;
    pendingEditParent = task;
  } else if (action === "restore") {
    clearTaskStateRecursive(task);
  } else if (action === "delete") {
    deleteTask(node);
  }
  if (shouldAnimateLayout && previousPositions) {
    startLayoutAnimation(previousPositions);
  }
  render();
}

function setTaskStateRecursive(task: Task, state: TaskState) {
  taskStates.set(task, state);
  (task.subtasks ?? []).forEach((child) => setTaskStateRecursive(child, state));
}

function clearTaskStateRecursive(task: Task) {
  taskStates.delete(task);
  (task.subtasks ?? []).forEach((child) => clearTaskStateRecursive(child));
}

function deleteTask(node: NodeHitbox) {
  const parent = node.parent;
  if (!parent || !parent.subtasks) return;
  parent.subtasks = parent.subtasks.filter((child) => child !== node.task);
  clearTaskStateRecursive(node.task);
}

function drawActionOverlay(
  task: Task,
  x: number,
  top: number,
  width: number,
  height: number,
  activeAction: ActionType | null
) {
  const actions = getActionsForTask(task);
  if (!actions.length) return;
  const sectionWidth = width / actions.length;
  ctx.save();
  ctx.lineWidth = 1;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  roundRect(x, top, width, height, NODE_RADIUS);
  ctx.clip();

  actions.forEach((actionType, index) => {
    const rawStart = x + index * sectionWidth;
    const rawEnd = x + (index + 1) * sectionWidth;
    const startX = index === 0 ? x : rawStart - 0.5;
    const endX = index === actions.length - 1 ? x + width : rawEnd + 0.5;
    const fillWidth = Math.max(endX - startX, sectionWidth);
    const config = ACTION_DEFINITIONS[actionType];
    ctx.fillStyle = activeAction === actionType ? config.activeColor : config.color;
    ctx.fillRect(startX, top, fillWidth, height);

    const centerX = rawStart + sectionWidth / 2;
    const centerY = top + height / 2;
    const iconSize = Math.min(sectionWidth, height) * 0.5;
    drawActionIcon(actionType, centerX, centerY, Math.min(iconSize, ACTION_ICON_BASE_SIZE));
  });

  ctx.restore();
  ctx.save();
  ctx.strokeStyle = OVERLAY_BORDER_COLOR;
  roundRect(x, top, width, height, NODE_RADIUS);
  ctx.stroke();
  ctx.restore();
}

function drawActionIcon(action: ActionType, centerX: number, centerY: number, size: number) {
  const half = size / 2;
  ctx.save();
  ctx.lineWidth = 2.4;
  ctx.strokeStyle = ACTION_ICON_COLOR;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.translate(centerX, centerY);

  switch (action) {
    case "cancel":
      ctx.beginPath();
      ctx.moveTo(-half, -half);
      ctx.lineTo(half, half);
      ctx.moveTo(half, -half);
      ctx.lineTo(-half, half);
      ctx.stroke();
      break;
    case "complete":
      ctx.beginPath();
      ctx.moveTo(-half * 0.6, 0);
      ctx.lineTo(-half * 0.1, half * 0.7);
      ctx.lineTo(half * 0.8, -half * 0.7);
      ctx.stroke();
      break;
    case "add":
      ctx.beginPath();
      ctx.moveTo(0, -half);
      ctx.lineTo(0, half);
      ctx.moveTo(-half, 0);
      ctx.lineTo(half, 0);
      ctx.stroke();
      break;
    case "restore":
      ctx.beginPath();
      ctx.arc(0, 0, half * 0.9, Math.PI * 0.2, Math.PI * 1.3);
      ctx.moveTo(-half * 0.2, -half * 0.2);
      ctx.lineTo(-half * 0.9, -half * 0.2);
      ctx.lineTo(-half * 0.7, half * 0.5);
      ctx.stroke();
      break;
    case "delete":
      ctx.beginPath();
      ctx.moveTo(-half * 0.6, -half * 0.4);
      ctx.lineTo(half * 0.6, -half * 0.4);
      ctx.moveTo(-half * 0.6, -half * 0.4);
      ctx.lineTo(-half * 0.5, half * 0.6);
      ctx.lineTo(half * 0.5, half * 0.6);
      ctx.lineTo(half * 0.6, -half * 0.4);
      ctx.moveTo(0, -half * 0.7);
      ctx.lineTo(0, -half * 0.4);
      ctx.moveTo(-half * 0.3, -half * 0.8);
      ctx.lineTo(half * 0.3, -half * 0.8);
      ctx.stroke();
      break;
  }

  ctx.restore();
}

function drawPendingNodes() {
  pendingNodes.forEach(({ task, x, y, hasChildren, parent, progress }) => {
    const top = y - NODE_HEIGHT / 2;
    nodeHitboxes.push({ task, parent, x, y: top, width: NODE_WIDTH, height: NODE_HEIGHT });
    drawNode(task, x, y, hasChildren, progress);
  });
}

function drawProgressBar(x: number, top: number, width: number, height: number, ratio: number) {
  const radius = NODE_RADIUS;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x + radius, top);
  ctx.lineTo(x + width - radius, top);
  ctx.quadraticCurveTo(x + width, top, x + width, top + radius);
  ctx.lineTo(x + width, top + height);
  ctx.lineTo(x, top + height);
  ctx.lineTo(x, top + radius);
  ctx.quadraticCurveTo(x, top, x + radius, top);
  ctx.closePath();
  ctx.clip();
  ctx.fillStyle = "rgba(15, 23, 42, 0.08)";
  ctx.fillRect(x, top, width, height);

  if (ratio > 0) {
    ctx.fillStyle = "rgba(34, 197, 94, 0.9)";
    ctx.fillRect(x, top, width * ratio, height);
  }
  ctx.restore();
}

function ensureEditingInput(): HTMLInputElement {
  if (editingInput) return editingInput;
  const input = document.createElement("input");
  input.type = "text";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.style.position = "absolute";
  input.style.zIndex = "10";
  input.style.border = "1px solid #d4d4d8";
  input.style.borderRadius = `${NODE_RADIUS}px`;
  input.style.background = "rgba(255,255,255,0.95)";
  input.style.boxShadow = "0 1px 2px rgba(15,23,42,0.08)";
  input.style.font = FONT;
  input.style.color = "#0f172a";
  input.style.padding = "6px 10px";
  input.style.display = "none";
  input.style.transformOrigin = "top left";
  input.style.boxSizing = "border-box";
  document.body.appendChild(input);

  input.addEventListener("input", () => {
    if (!editingTask) return;
    editingTask.label = input.value;
    render();
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      finishEditingTask(true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      finishEditingTask(false);
    }
  });

  input.addEventListener("blur", () => {
    if (!editingTask) return;
    finishEditingTask(true);
  });

  editingInput = input;
  return input;
}

function startEditingTask(task: Task, parent: Task | null) {
  const input = ensureEditingInput();
  editingTask = task;
  editingParentForRemoval = parent;
  editingInitialLabel = task.label;
  input.value = task.label;
  input.style.display = "block";
  positionEditingInput();
  requestAnimationFrame(() => {
    input.focus();
    input.select();
  });
}

function positionEditingInput() {
  const input = editingInput;
  if (!input) return;
  if (!editingTask) {
    input.style.display = "none";
    return;
  }
  const position = displayPositions.get(editingTask);
  if (!position) {
    input.style.display = "none";
    return;
  }
  const rect = canvas.getBoundingClientRect();
  const screenX = rect.left + panX + zoom * position.x;
  const screenY = rect.top + panY + zoom * (position.y - NODE_HEIGHT / 2);
  const width = NODE_WIDTH * zoom;
  const height = NODE_HEIGHT * zoom;
  const fontSize = clamp(16 * zoom, 12, 22);
  const paddingY = clamp(6 * zoom, 4, 12);
  const paddingX = clamp(10 * zoom, 6, 18);

  input.style.display = "block";
  input.style.left = `${screenX}px`;
  input.style.top = `${screenY}px`;
  input.style.width = `${Math.max(40, width)}px`;
  input.style.height = `${Math.max(24, height)}px`;
  input.style.fontSize = `${fontSize}px`;
  input.style.padding = `${paddingY}px ${paddingX}px`;
}

function finishEditingTask(commit: boolean) {
  if (!editingTask || !editingInput) return;
  const task = editingTask;
  const parent = editingParentForRemoval;
  const inputValue = editingInput.value;
  if (!commit) {
    if (!editingInitialLabel.trim() && parent) {
      removeTaskFromParent(task, parent);
    } else {
      task.label = editingInitialLabel;
    }
  } else {
    const trimmed = inputValue.trim();
    if (!trimmed) {
      if (parent) {
        removeTaskFromParent(task, parent);
      } else {
        task.label = editingInitialLabel;
      }
    } else {
      task.label = trimmed;
    }
  }

  editingTask = null;
  editingParentForRemoval = null;
  editingInitialLabel = "";
  editingInput.style.display = "none";
  render();
}

function removeTaskFromParent(task: Task, parent: Task | null) {
  if (!parent || !parent.subtasks) return;
  parent.subtasks = parent.subtasks.filter((child) => child !== task);
  clearTaskStateRecursive(task);
}

function captureDisplayPositions(): Map<Task, Position> {
  return new Map(displayPositions);
}

function startLayoutAnimation(startPositions: Map<Task, Position>) {
  layoutAnimationStartPositions = startPositions;
  layoutAnimationStartTime = performance.now();
  layoutAnimationProgress = 0;
  scheduleAnimationFrame();
}

function updateLayoutAnimationState(now: number) {
  if (!layoutAnimationStartPositions) {
    layoutAnimationProgress = 1;
    return;
  }
  const elapsed = now - layoutAnimationStartTime;
  if (elapsed >= LAYOUT_ANIMATION_DURATION) {
    layoutAnimationStartPositions = null;
    layoutAnimationProgress = 1;
    return;
  }
  const normalized = Math.min(Math.max(elapsed / LAYOUT_ANIMATION_DURATION, 0), 1);
  layoutAnimationProgress = easeInOutCubic(normalized);
  scheduleAnimationFrame();
}

function scheduleAnimationFrame() {
  if (animationFrameHandle !== null) return;
  animationFrameHandle = requestAnimationFrame((time) => {
    animationFrameHandle = null;
    render(time);
  });
}

function lerp(start: number, end: number, t: number) {
  return start + (end - start) * t;
}

function easeInOutCubic(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
