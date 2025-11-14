import "./index.css";
import type { IconNode } from "lucide";
import { Check, Edit, Plus, RotateCcw, Trash2, X } from "lucide";

type Task = {
  label: string;
  subtasks: Task[];
};

type LayoutRange = [number, number];
type Viewport = { width: number; height: number; dpr: number };
type TaskState = "default" | "completed" | "cancelled";
type ActionType = "cancel" | "complete" | "add" | "restore" | "delete" | "rename";
type Position = { x: number; y: number };
type FloatingAddButton = { cx: number; cy: number; radius: number };

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
  rename: { color: "#fef3c7", activeColor: "#fbbf24" },
};
const ACTION_ICON_BASE_SIZE = 20;
const ACTION_ICON_COLOR = "#0f172a";
const KEYBOARD_PAN_STEP = 48;
const KEYBOARD_ZOOM_FACTOR = 1.12;
const KEYBOARD_PAN_SPEED = 800; // pixels per second
const VIEWPORT_ANIMATION_EPS = 0.1;
const PAN_ANIMATION_FACTOR = 0.15;
const ZOOM_ANIMATION_FACTOR = 0.15;

const ACTION_ICONS: Record<ActionType, IconNode> = {
  cancel: X,
  complete: Check,
  add: Plus,
  restore: RotateCcw,
  delete: Trash2,
  rename: Edit,
};
const OVERLAY_BORDER_COLOR = "rgba(15, 23, 42, 0.2)";
const FLOATING_ADD_RADIUS = 18;
const FLOATING_ADD_GAP = 12;
const FLOATING_ADD_COLOR = "#2563eb";
const FLOATING_ADD_ACTIVE_COLOR = "#1d4ed8";
const FLOATING_ADD_ICON_COLOR = "#ffffff";
let leafCounts = new WeakMap<Task, number>();

function getLeafCount(task: Task): number {
  const cached = leafCounts.get(task);
  if (cached !== undefined) return cached;
  const subtasks = task.subtasks;
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
                { label: "Rec letter 1", subtasks: [] },
                { label: "Rec letter 2", subtasks: [] },
                { label: "Rec letter 3", subtasks: [] },
              ],
            },
            { label: "Application letter", subtasks: [] },
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
let panTargetX = panX;
let panTargetY = panY;
let zoomTarget = zoom;
let viewportAnimationHandle: number | null = null;
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
let pendingHoverTask: Task | null = null;
const ROOT_ADD_BUTTON_ID = "add-root-task-button";
const pressedKeys = new Set<string>();
let keyboardAnimationHandle: number | null = null;
let lastKeyboardAnimationTime: number = 0;

setupPanHandlers(canvas);
setupZoomHandler(canvas);
window.addEventListener("resize", () => {
  viewport = configureCanvas(canvas, ctx);
  render();
});
setupAddRootChildButton();
setupKeyboardShortcuts();

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
  
  // Select parent after deletion
  if (pendingHoverTask) {
    const nodeHitbox = nodeHitboxes.find(n => n.task === pendingHoverTask);
    if (nodeHitbox) {
      hoveredNode = nodeHitbox;
      hoveredAction = null;
    } else {
      // If parent not found, clear hover to prevent ghost hover
      hoveredNode = null;
      hoveredAction = null;
    }
    pendingHoverTask = null;
    // Trigger another render to show the selection
    requestAnimationFrame(() => render());
    return;
  }
  
  if (pendingEditTask) {
    // Set the node as hovered so it's highlighted (menu overlay will be drawn)
    const nodeHitbox = nodeHitboxes.find(n => n.task === pendingEditTask);
    if (nodeHitbox) {
      hoveredNode = nodeHitbox;
      hoveredAction = null; // Show menu overlay
    }
    const taskToEdit = pendingEditTask;
    const parentToEdit = pendingEditParent;
    pendingEditTask = null;
    pendingEditParent = null;
    // Start editing - input will be on top with higher z-index
    startEditingTask(taskToEdit, parentToEdit);
    // Trigger another render to show the menu overlay (input is already on top)
    requestAnimationFrame(() => render());
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
    let hitNode = hitTestNode(worldX, worldY);
    let action: ActionType | null = null;
    if (hitNode) {
      // Don't allow interaction with root task
      if (hitNode.task === rootTask) {
        hitNode = null;
      } else {
        action = getActionFromPosition(hitNode, worldX);
      }
    }
    if (!hitNode || action === null) {
      const addButtonNode = hitTestFloatingAddButton(worldX, worldY);
      if (addButtonNode && addButtonNode.task !== rootTask) {
        hitNode = addButtonNode;
        action = "add";
      }
    }
    hoveredNode = hitNode;
    hoveredAction = action;
    render();
  };

  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    if (editingInput && editingTask) {
      editingInput.blur();
    }
    updateHoverState(event);
    // Don't allow actions on root task
    if (hoveredNode && hoveredNode.task === rootTask) {
      event.preventDefault();
      return;
    }
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
      panTargetX = panX;
      panTargetY = panY;
      zoomTarget = zoom;
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
      if (newZoom === zoomTarget) return;
      const worldX = (canvasX - panX) / zoom;
      const worldY = (canvasY - panY) / zoom;
      const targetPanX = canvasX - worldX * newZoom;
      const targetPanY = canvasY - worldY * newZoom;
      zoomTarget = newZoom;
      panTargetX = targetPanX;
      panTargetY = targetPanY;
      scheduleViewportAnimation();
    },
    { passive: false }
  );
}

function panViewport(dx: number, dy: number) {
  panTargetX += dx;
  panTargetY += dy;
  scheduleViewportAnimation();
}

function adjustZoomByKeyboard(factor: number) {
  const canvasCenterX = viewport.width / 2;
  const canvasCenterY = viewport.height / 2;
  const worldX = (canvasCenterX - panX) / zoom;
  const worldY = (canvasCenterY - panY) / zoom;
  const newZoom = clamp(zoomTarget * factor, ZOOM_MIN, ZOOM_MAX);
  if (newZoom === zoomTarget) return;
  zoomTarget = newZoom;
  panTargetX = canvasCenterX - worldX * newZoom;
  panTargetY = canvasCenterY - worldY * newZoom;
  scheduleViewportAnimation();
}

function scheduleViewportAnimation() {
  if (viewportAnimationHandle !== null) return;
  viewportAnimationHandle = requestAnimationFrame(stepViewportAnimation);
}

function stepViewportAnimation(time: number) {
  viewportAnimationHandle = null;
  const deltaX = panTargetX - panX;
  const deltaY = panTargetY - panY;
  const deltaZoom = zoomTarget - zoom;

  let moving = false;
  if (Math.abs(deltaX) > VIEWPORT_ANIMATION_EPS) {
    panX += deltaX * PAN_ANIMATION_FACTOR;
    moving = true;
  } else {
    panX = panTargetX;
  }
  if (Math.abs(deltaY) > VIEWPORT_ANIMATION_EPS) {
    panY += deltaY * PAN_ANIMATION_FACTOR;
    moving = true;
  } else {
    panY = panTargetY;
  }
  if (Math.abs(deltaZoom) > VIEWPORT_ANIMATION_EPS) {
    zoom += deltaZoom * ZOOM_ANIMATION_FACTOR;
    moving = true;
  } else {
    zoom = zoomTarget;
  }

  render();
  if (moving) {
    scheduleViewportAnimation();
  }
}

function addRootChild() {
  const newTask: Task = { label: "", subtasks: [] };
  rootTask.subtasks.push(newTask);
  pendingEditTask = newTask;
  pendingEditParent = rootTask;
  render();
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
    addRootChild();
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

function setupKeyboardShortcuts() {
  window.addEventListener("keydown", (event) => {
    if (editingTask) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    // Don't allow keyboard shortcuts on root task
    if (hoveredNode && hoveredNode.task === rootTask) return;
    let handled = false;

    const key = event.key.toLowerCase();
    
    // Handle WASD for smooth panning
    if (key === "w" || key === "s" || key === "a" || key === "d") {
      if (!pressedKeys.has(key)) {
        pressedKeys.add(key);
        event.preventDefault();
        startKeyboardAnimation();
        handled = true;
      }
    }

    // Handle other shortcuts (non-continuous)
    if (!handled) {
      switch (event.key) {
        case "ArrowUp":
        case "k":
        case "K":
          event.preventDefault();
          moveHoveredNode("up");
          handled = true;
          break;
        case "ArrowDown":
        case "j":
        case "J":
          event.preventDefault();
          moveHoveredNode("down");
          handled = true;
          break;
        case "ArrowLeft":
        case "h":
        case "H":
          event.preventDefault();
          moveHoveredNode("left");
          handled = true;
          break;
        case "ArrowRight":
        case "l":
        case "L":
          event.preventDefault();
          moveHoveredNode("right");
          handled = true;
          break;
        case " ":
        case "Spacebar":
        case "Space": {
          if (!hoveredNode) break;
          event.preventDefault();
          handleAction("complete", hoveredNode);
          handled = true;
          break;
        }
        case "Enter": {
          event.preventDefault();
          if (event.shiftKey) {
            // Shift+Enter: create a new node
            if (hoveredNode && hoveredNode.task !== rootTask) {
              handleAction("add", hoveredNode);
            } else {
              addRootChild();
            }
          } else {
            // Enter: rename the hovered node
            if (hoveredNode && hoveredNode.task !== rootTask) {
              handleAction("rename", hoveredNode);
            }
          }
          handled = true;
          break;
        }
        case "r":
        case "R": {
          if (!hoveredNode) break;
          event.preventDefault();
          handleAction("rename", hoveredNode);
          handled = true;
          break;
        }
        case "c":
        case "C": {
          if (!hoveredNode) break;
          event.preventDefault();
          handleAction("cancel", hoveredNode);
          handled = true;
          break;
        }
        case "Backspace": {
          if (!hoveredNode) break;
          event.preventDefault();
          if (event.shiftKey) {
            // Shift+Backspace: delete
            handleAction("delete", hoveredNode);
          } else {
            // Backspace: cancel/uncancel
            handleAction("cancel", hoveredNode);
          }
          handled = true;
          break;
        }
      }
    }

    if (handled) {
      hoveredAction = null;
    }
  });

  window.addEventListener("keyup", (event) => {
    if (editingTask) return;
    const key = event.key.toLowerCase();
    if (key === "w" || key === "s" || key === "a" || key === "d") {
      pressedKeys.delete(key);
      if (pressedKeys.size === 0) {
        stopKeyboardAnimation();
      }
    }
  });

  // Handle case where user switches tabs or loses focus
  window.addEventListener("blur", () => {
    pressedKeys.clear();
    stopKeyboardAnimation();
  });
}

function startKeyboardAnimation() {
  if (keyboardAnimationHandle !== null) return;
  lastKeyboardAnimationTime = performance.now();
  keyboardAnimationHandle = requestAnimationFrame(stepKeyboardAnimation);
}

function stopKeyboardAnimation() {
  if (keyboardAnimationHandle !== null) {
    cancelAnimationFrame(keyboardAnimationHandle);
    keyboardAnimationHandle = null;
  }
}

function stepKeyboardAnimation(time: number) {
  keyboardAnimationHandle = null;
  
  if (pressedKeys.size === 0) {
    return;
  }

  const deltaTime = (time - lastKeyboardAnimationTime) / 1000; // Convert to seconds
  lastKeyboardAnimationTime = time;

  let panDx = 0;
  let panDy = 0;

  // Calculate panning deltas
  if (pressedKeys.has("w")) {
    panDy += KEYBOARD_PAN_SPEED * deltaTime;
  }
  if (pressedKeys.has("s")) {
    panDy -= KEYBOARD_PAN_SPEED * deltaTime;
  }
  if (pressedKeys.has("a")) {
    panDx += KEYBOARD_PAN_SPEED * deltaTime;
  }
  if (pressedKeys.has("d")) {
    panDx -= KEYBOARD_PAN_SPEED * deltaTime;
  }

  // Apply panning
  if (panDx !== 0 || panDy !== 0) {
    panTargetX += panDx;
    panTargetY += panDy;
    scheduleViewportAnimation();
  }

  // Continue animation if keys are still pressed
  if (pressedKeys.size > 0) {
    keyboardAnimationHandle = requestAnimationFrame(stepKeyboardAnimation);
  }
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
  const childDepths = task.subtasks.map((child) =>
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

  const subtasks = task.subtasks;
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

function drawNode(
  task: Task,
  x: number,
  centerY: number,
  hasChildren: boolean,
  progress?: NodeProgress,
  addButton?: FloatingAddButton | null
) {
  const label = task.label;
  const state = taskStates.get(task) ?? "default";
  const top = centerY - NODE_HEIGHT / 2;
  const colorSet =
    state === "completed"
      ? NODE_COLORS.completed
      : state === "cancelled"
      ? NODE_COLORS.cancelled
      : NODE_COLORS.default;

  const progressRatio =
    progress && progress.total > 0 ? Math.min(progress.completed / progress.total, 1) : null;

  const isAddHover = hoveredNode?.task === task && hoveredAction === "add";
  const showMenu = hoveredNode?.task === task && !isAddHover && hoveredAction === null;

  ctx.save();
  // If showing menu above, don't round the top corners
  if (showMenu) {
    roundRectTopFlat(x, top, NODE_WIDTH, NODE_HEIGHT, NODE_RADIUS);
  } else {
    roundRect(x, top, NODE_WIDTH, NODE_HEIGHT, NODE_RADIUS);
  }
  ctx.clip();
  ctx.fillStyle = colorSet.fill;
  ctx.fillRect(x, top, NODE_WIDTH, NODE_HEIGHT);
  if (progressRatio !== null && progressRatio > 0) {
    drawProgressOverlay(x, top, NODE_WIDTH, NODE_HEIGHT, progressRatio);
  }
  ctx.restore();

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
  
  // If showing menu above, don't round the top corners
  if (showMenu) {
    roundRectTopFlat(x, top, NODE_WIDTH, NODE_HEIGHT, NODE_RADIUS);
  } else {
    roundRect(x, top, NODE_WIDTH, NODE_HEIGHT, NODE_RADIUS);
  }
  ctx.stroke();

  const textColor =
    state === "completed"
      ? NODE_COLORS.completed.text
      : state === "cancelled"
      ? NODE_COLORS.cancelled.text
      : NODE_COLORS.default.text;
  ctx.fillStyle = textColor;
  ctx.fillText(label, x + NODE_PADDING_X, centerY);
  
  // Draw menu above node if showing menu (slightly shorter)
  if (showMenu) {
    const menuHeight = NODE_HEIGHT * 0.75; // 75% of node height
    const menuTop = top - menuHeight;
    drawActionOverlay(task, x, menuTop, NODE_WIDTH, menuHeight, hoveredAction);
    
    // Draw highlight around both menu and node
    ctx.save();
    ctx.strokeStyle = "#2563eb"; // Blue highlight color
    ctx.lineWidth = 3;
    // Draw a rounded rect that contains both menu and node
    const combinedHeight = menuHeight + NODE_HEIGHT;
    const combinedTop = menuTop;
    roundRect(x, combinedTop, NODE_WIDTH, combinedHeight, NODE_RADIUS);
    ctx.stroke();
    ctx.restore();
  }
  if (addButton) {
    drawFloatingAddButton(task, addButton);
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

function roundRectTopFlat(x: number, y: number, width: number, height: number, radius: number) {
  // Rounded bottom corners only, flat top
  ctx.beginPath();
  ctx.moveTo(x, y); // Top left, no rounding
  ctx.lineTo(x + width, y); // Top right, no rounding
  ctx.lineTo(x + width, y + height - radius); // Right side down
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height); // Bottom right corner
  ctx.lineTo(x + radius, y + height); // Bottom
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius); // Bottom left corner
  ctx.lineTo(x, y); // Left side up
  ctx.closePath();
}

function roundRectBottomFlat(x: number, y: number, width: number, height: number, radius: number) {
  // Rounded top corners only, flat bottom
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height); // Right side down, no rounding
  ctx.lineTo(x, y + height); // Bottom, no rounding
  ctx.lineTo(x, y + radius); // Left side up
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

type Direction = "up" | "down" | "left" | "right";

type NodeHitbox = {
  task: Task;
  parent: Task | null;
  x: number;
  y: number;
  width: number;
  height: number;
  addButton?: FloatingAddButton | null;
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

function hitTestFloatingAddButton(worldX: number, worldY: number): NodeHitbox | null {
  for (let i = nodeHitboxes.length - 1; i >= 0; i -= 1) {
    const node = nodeHitboxes[i];
    const addButton = node.addButton;
    if (!addButton) continue;
    const dx = worldX - addButton.cx;
    const dy = worldY - addButton.cy;
    if (dx * dx + dy * dy <= addButton.radius * addButton.radius) {
      return node;
    }
  }
  return null;
}

function moveHoveredNode(direction: Direction) {
  if (!nodeHitboxes.length) return;
  if (!hoveredNode) {
    hoveredNode = nodeHitboxes[0];
    hoveredAction = null;
    render();
    return;
  }
  const neighbor = findDirectionalNeighbor(hoveredNode, direction);
  if (!neighbor) return;
  hoveredNode = neighbor;
  hoveredAction = null;
  render();
}

function findDirectionalNeighbor(origin: NodeHitbox | null, direction: Direction): NodeHitbox | null {
  if (!origin) return null;
  const originCenterX = origin.x + origin.width / 2;
  const originCenterY = origin.y + origin.height / 2;
  let best: NodeHitbox | null = null;
  let bestScore = Infinity;
  nodeHitboxes.forEach((candidate) => {
    if (candidate === origin) return;
    const candidateCenterX = candidate.x + candidate.width / 2;
    const candidateCenterY = candidate.y + candidate.height / 2;
    const dx = candidateCenterX - originCenterX;
    const dy = candidateCenterY - originCenterY;
    let inDirection = false;
    let primary = 0;
    let secondary = 0;
    switch (direction) {
      case "up":
        if (dy >= 0) return;
        inDirection = true;
        primary = Math.abs(dy);
        secondary = Math.abs(dx) * 0.5;
        break;
      case "down":
        if (dy <= 0) return;
        inDirection = true;
        primary = Math.abs(dy);
        secondary = Math.abs(dx) * 0.5;
        break;
      case "left":
        if (dx >= 0) return;
        inDirection = true;
        primary = Math.abs(dx);
        secondary = Math.abs(dy) * 0.5;
        break;
      case "right":
        if (dx <= 0) return;
        inDirection = true;
        primary = Math.abs(dx);
        secondary = Math.abs(dy) * 0.5;
        break;
    }
    if (!inDirection) return;
    const score = primary + secondary;
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  });
  return best;
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
  // Base/root task is not interactable
  if (task === rootTask) {
    return [];
  }
  const state = taskStates.get(task) ?? "default";
  if (state === "cancelled" || state === "completed") {
    return ["delete", "restore"];
  }
  return ["cancel", "rename", "complete"];
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
    const newTask: Task = {
      label: "",
      subtasks: [],
    };
    task.subtasks.push(newTask);
    taskStates.delete(task);
    pendingEditTask = newTask;
    pendingEditParent = task;
  } else if (action === "restore") {
    clearTaskStateRecursive(task);
  } else if (action === "delete") {
    // Prevent deleting the root task
    if (task === rootTask) {
      return;
    }
    const parent = node.parent;
    // Clear hovered node immediately to prevent ghost hover
    if (hoveredNode && hoveredNode.task === task) {
      hoveredNode = null;
      hoveredAction = null;
    }
    deleteTask(node);
    // Select the parent after deletion
    if (parent) {
      pendingHoverTask = parent;
    } else {
      // If no parent, clear hover completely
      hoveredNode = null;
      hoveredAction = null;
    }
  } else if (action === "rename") {
    startEditingTask(task, node.parent);
  }
  if (shouldAnimateLayout && previousPositions) {
    startLayoutAnimation(previousPositions);
  }
  render();
}

function setTaskStateRecursive(task: Task, state: TaskState) {
  taskStates.set(task, state);
  task.subtasks.forEach((child) => setTaskStateRecursive(child, state));
}

function clearTaskStateRecursive(task: Task) {
  taskStates.delete(task);
  task.subtasks.forEach((child) => clearTaskStateRecursive(child));
}

function deleteTask(node: NodeHitbox) {
  const parent = node.parent;
  if (!parent) return;
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
  const isDefaultState = (taskStates.get(task) ?? "default") === "default";
  const sectionWidth = width / actions.length;
  ctx.save();
  ctx.lineWidth = 1;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  // Use bottom-flat rounded rect (flat bottom to connect with node)
  roundRectBottomFlat(x, top, width, height, NODE_RADIUS);
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
    const iconMultiplier = isDefaultState ? 0.6 : 0.5;
    const iconSize = Math.min(sectionWidth, height) * iconMultiplier;
    drawActionIcon(actionType, centerX, centerY, Math.min(iconSize, ACTION_ICON_BASE_SIZE));
  });

  ctx.restore();
  ctx.save();
  ctx.strokeStyle = OVERLAY_BORDER_COLOR;
  // Use bottom-flat rounded rect for border
  roundRectBottomFlat(x, top, width, height, NODE_RADIUS);
  ctx.stroke();
  ctx.restore();
}

function drawFloatingAddButton(task: Task, button: FloatingAddButton) {
  if (!shouldShowFloatingAddButton(task)) return;
  const isHovered = hoveredNode?.task === task && hoveredAction === "add";
  ctx.save();
  ctx.beginPath();
  const visualRadius = FLOATING_ADD_RADIUS;
  ctx.arc(button.cx, button.cy, visualRadius, 0, Math.PI * 2);
  ctx.shadowColor = "rgba(37, 99, 235, 0.3)";
  ctx.shadowBlur = 12;
  ctx.fillStyle = isHovered ? FLOATING_ADD_ACTIVE_COLOR : FLOATING_ADD_COLOR;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.5)";
  ctx.lineWidth = 1;
  ctx.stroke();
  const icon = ACTION_ICONS.add;
  const iconSize = FLOATING_ADD_RADIUS * 1;
  drawLucideIcon(icon, button.cx, button.cy, iconSize, FLOATING_ADD_ICON_COLOR);
  ctx.restore();
}

function getFloatingAddButtonPlacement(task: Task, nodeX: number, centerY: number): FloatingAddButton | null {
  const state = taskStates.get(task) ?? "default";
  if (state !== "default") return null;
  return {
    cx: nodeX - FLOATING_ADD_GAP - FLOATING_ADD_RADIUS,
    cy: centerY,
    radius: FLOATING_ADD_RADIUS * 1.6,
  };
}

function shouldShowFloatingAddButton(task: Task): boolean {
  if (!hoveredNode) return false;
  return hoveredNode.task === task;
}

function drawActionIcon(action: ActionType, centerX: number, centerY: number, size: number) {
  const icon = ACTION_ICONS[action];
  if (!icon) return;
  drawLucideIcon(icon, centerX, centerY, size, ACTION_ICON_COLOR);
}

function drawLucideIcon(icon: IconNode, centerX: number, centerY: number, size: number, color: string) {
  const viewBoxSize = 24;
  ctx.save();
  ctx.translate(centerX - size / 2, centerY - size / 2);
  const scale = size / viewBoxSize;
  ctx.scale(scale, scale);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2;

  icon.forEach(([tag, attrs]) => {
    switch (tag) {
      case "path": {
        const d = attrs.d;
        if (!d) break;
        const path = new Path2D(String(d));
        const fill = (attrs.fill as string) ?? "none";
        if (fill && fill !== "none") {
          ctx.fill(path);
        }
        ctx.stroke(path);
        break;
      }
      default:
        break;
    }
  });

  ctx.restore();
}

function drawPendingNodes() {
  pendingNodes.forEach(({ task, x, y, hasChildren, parent, progress }) => {
    const top = y - NODE_HEIGHT / 2;
    const addButton = getFloatingAddButtonPlacement(task, x, y);
    nodeHitboxes.push({
      task,
      parent,
      x,
      y: top,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      addButton,
    });
    drawNode(task, x, y, hasChildren, progress, addButton);
  });
}

function drawProgressOverlay(x: number, top: number, width: number, height: number, ratio: number) {
  const fillWidth = Math.max(width * ratio, 0);
  if (fillWidth <= 0) return;

  const gradient = ctx.createLinearGradient(x, top, x + fillWidth, top);
  gradient.addColorStop(0, "rgba(34, 197, 94, 0.25)");
  gradient.addColorStop(0.5, "rgba(34, 197, 94, 0.35)");
  gradient.addColorStop(1, "rgba(34, 197, 94, 0.45)");

  ctx.fillStyle = gradient;
  ctx.fillRect(x, top, fillWidth, height);

  ctx.fillStyle = "rgba(255, 255, 255, 0.35)";
  ctx.fillRect(x, top, fillWidth, 1);
  ctx.fillStyle = "rgba(15, 23, 42, 0.15)";
  ctx.fillRect(x, top + height - 1, fillWidth, 1);
}

function ensureEditingInput(): HTMLInputElement {
  if (editingInput) return editingInput;
  const input = document.createElement("input");
  input.type = "text";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.style.position = "absolute";
  input.style.zIndex = "100"; // Higher z-index to show above menu overlay
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
      event.stopPropagation();
    } else if (event.key === "Escape") {
      event.preventDefault();
      finishEditingTask(false);
      event.stopPropagation();
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

function drawTooltipBubble(node: NodeHitbox) {
  const task = node.task;
  const label = task.label || "(empty)";
  
  // Calculate screen position
  const screenX = panX + zoom * (node.x + node.width / 2);
  const screenY = panY + zoom * node.y;
  
  // Tooltip styling
  const padding = 8;
  const borderRadius = 6;
  const fontSize = 12;
  const lineHeight = 16;
  const maxWidth = 200;
  
  ctx.save();
  ctx.font = `${fontSize}px 'Inter', system-ui`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  
  // Measure text
  const metrics = ctx.measureText(label);
  const textWidth = Math.min(metrics.width, maxWidth);
  const tooltipWidth = textWidth + padding * 2;
  const tooltipHeight = lineHeight + padding * 2;
  
  // Position above the node
  const tooltipX = screenX - tooltipWidth / 2;
  const tooltipY = screenY - tooltipHeight - 8; // 8px gap above node
  
  // Draw bubble background
  ctx.fillStyle = "rgba(15, 23, 42, 0.95)";
  ctx.beginPath();
  roundRect(tooltipX, tooltipY, tooltipWidth, tooltipHeight, borderRadius);
  ctx.fill();
  
  // Draw border
  ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
  ctx.lineWidth = 1;
  roundRect(tooltipX, tooltipY, tooltipWidth, tooltipHeight, borderRadius);
  ctx.stroke();
  
  // Draw text
  ctx.fillStyle = "#ffffff";
  ctx.fillText(label, screenX, tooltipY + padding);
  
  ctx.restore();
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
