import './style.css'

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <div style="max-width: 800px; margin: auto;">
    <h1>Ant Colony Simulator</h1>
    <div style="margin-bottom: 1em;">
      <label>Simulation Speed: <input id="speed-slider" type="range" min="0" max="4" value="0" style="width: 200px;" /></label>
      <span id="speed-display" style="margin-left: 0.5em; font-weight: bold;">1x</span>
    </div>
    <div style="margin-bottom: 1em;">
      <label>Number of Ants: <input id="num-ants" type="number" min="1" max="500" value="50" /></label>
      <label style="margin-left: 1em;">Number of Food Sources: <input id="num-food" type="number" min="1" max="10" value="3" /></label>
      <label style="margin-left: 1em;">Number of Obstacles: <input id="num-obstacles" type="number" min="0" max="20" value="2" /></label>
      <button id="start-sim">Start Simulation</button>
    </div>
    <div style="margin-bottom: 1em;">
      <label><input id="debug-toggle" type="checkbox" /> Show Debug Info</label>
      <label style="margin-left: 2em;"><input id="pheromone-toggle" type="checkbox" checked /> Show Pheromones</label>
    </div>
    <canvas id="sim-canvas" width="800" height="600" style="border:1px solid #888;"></canvas>
  </div>
`;

let showDebug = false;
const debugToggle = document.getElementById('debug-toggle') as HTMLInputElement;
debugToggle.addEventListener('change', () => {
  showDebug = debugToggle.checked;
});

let showPheromones = true;
const pheromoneToggle = document.getElementById('pheromone-toggle') as HTMLInputElement;
pheromoneToggle.addEventListener('change', () => {
  showPheromones = pheromoneToggle.checked;
});

// Speed control
let simulationSpeed = 1;
const speedValues = [1, 2, 3, 5, 10];
const speedSlider = document.getElementById('speed-slider') as HTMLInputElement;
const speedDisplay = document.getElementById('speed-display') as HTMLSpanElement;

speedSlider.addEventListener('input', () => {
  const index = parseInt(speedSlider.value, 10);
  simulationSpeed = speedValues[index];
  speedDisplay.textContent = `${simulationSpeed}x`;
});

type Pheromone = { x: number; y: number; strength: number; type: 'home' | 'food' };
type FoodSource = { x: number; y: number; amount: number };
type Obstacle = {
  x: number;
  y: number;
  radius: number; // For now, obstacles are circles
};
type Ant = {
  x: number;
  y: number;
  angle: number;
  hasFood: boolean;
  memory: { home?: { x: number; y: number }; food?: { x: number; y: number }; forgetTimer: number };
  directionChangeTimer: number;
  lookAroundTimer: number; // NEW: timer for looking around after pickup/drop
  followingPheromone?: boolean; // NEW: flag to track if the ant is following a pheromone
  lastPheromoneType?: 'home' | 'food'; // NEW: type of the last pheromone followed
  pheromonePersistence?: number; // NEW: counter for pheromone persistence
};

const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 600;
const HOME_RADIUS = 18;
const FOOD_RADIUS = 14;
const ANT_RADIUS = 4;
const PHEROMONE_RADIUS = 2;
const PHEROMONE_DECAY = 0.995;
const PHEROMONE_DROP_RATE = 0.8;
const PHEROMONE_ERROR = 0.18;
const MEMORY_DURATION = 480; // moves
const FOOD_AMOUNT = 60;
const SENSE_RADIUS = 90;
const SENSE_ANGLE = 120;

let ants: Ant[] = [];
let pheromones: Pheromone[] = [];
let foodSources: FoodSource[] = [];
let obstacles: Obstacle[] = [];
let home = { x: 0, y: 0, foodDeposited: 0 };
let animationId: number | null = null;

// --- Coordinate conversion helpers ---
function toCanvasCoords(centerX: number, centerY: number) {
  return {
    x: centerX + CANVAS_WIDTH / 2,
    y: centerY + CANVAS_HEIGHT / 2,
  };
}
function fromCanvasCoords(canvasX: number, canvasY: number) {
  return {
    x: canvasX - CANVAS_WIDTH / 2,
    y: canvasY - CANVAS_HEIGHT / 2,
  };
}

function randomPos(radius: number) {
  // Generate random position in center-based coordinates
  return {
    x: Math.random() * (CANVAS_WIDTH - 2 * radius) - (CANVAS_WIDTH / 2 - radius),
    y: Math.random() * (CANVAS_HEIGHT - 2 * radius) - (CANVAS_HEIGHT / 2 - radius),
  };
}

function resetSimulation(numAnts: number, numFood: number, numObstacles: number) {
  // Generate home at a random position
  let homePos;
  let tries = 0;
  do {
    homePos = randomPos(HOME_RADIUS);
    tries++;
  } while (tries < 30 && (
    // Avoid placing home too close to the edge
    Math.abs(homePos.x) > CANVAS_WIDTH / 2 - HOME_RADIUS - 20 ||
    Math.abs(homePos.y) > CANVAS_HEIGHT / 2 - HOME_RADIUS - 20
  ));
  home = { x: homePos.x, y: homePos.y, foodDeposited: 0 };

  ants = Array.from({ length: numAnts }, () => {
    const pos = randomPos(ANT_RADIUS);
    const angle = Math.random() * 360;
    return {
      x: pos.x,
      y: pos.y,
      angle: angle,
      hasFood: false,
      memory: { forgetTimer: 0 },
      directionChangeTimer: Math.floor(Math.random() * 60) + 40, // 40-100 frames
      lookAroundTimer: 0, // NEW: timer for looking around after pickup/drop
    };
  });
  pheromones = [];
  foodSources = Array.from({ length: numFood }, () => {
    let pos: { x: number; y: number };
    let amount: number;
    let tries = 0;
    do {
      pos = randomPos(FOOD_RADIUS);
      tries++;
    } while (
      (Math.hypot(pos.x - home.x, pos.y - home.y) < 80 ||
      foodSources.some(f => Math.hypot(pos.x - f.x, pos.y - f.y) < 40)) && tries < 30
    );
    amount = Math.floor(Math.random() * (100 - 30 + 1)) + 30; // random between 30 and 100
    return { ...pos, amount };
  });
  // Generate obstacles
  obstacles = Array.from({ length: numObstacles }, () => {
    let pos: { x: number; y: number };
    let radius: number;
    let tries = 0;
    do {
      radius = Math.random() * 30 + 20; // radius 20-50
      pos = randomPos(radius);
      tries++;
    } while (
      (Math.hypot(pos.x - home.x, pos.y - home.y) < HOME_RADIUS + radius + 20 ||
      foodSources.some(f => Math.hypot(pos.x - f.x, pos.y - f.y) < FOOD_RADIUS + radius + 10) ||
      obstacles.some(o => Math.hypot(pos.x - o.x, pos.y - o.y) < o.radius + radius + 10)) && tries < 30
    );
    return { x: pos.x, y: pos.y, radius };
  });
}

function drawWorld(ctx: CanvasRenderingContext2D) {
  ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  // Draw obstacles (draw under everything)
  for (const obs of obstacles) {
    const obsCanvas = toCanvasCoords(obs.x, obs.y);
    ctx.beginPath();
    ctx.arc(obsCanvas.x, obsCanvas.y, obs.radius, 0, Math.PI * 2);
    ctx.fillStyle = '#444';
    ctx.globalAlpha = 0.7;
    ctx.fill();
    ctx.globalAlpha = 1.0;
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  // Draw pheromones (draw first, so they are under everything)
  if (showPheromones) {
    for (const p of pheromones) {
      const pCanvas = toCanvasCoords(p.x, p.y);
      ctx.beginPath();
      ctx.arc(pCanvas.x, pCanvas.y, PHEROMONE_RADIUS, 0, Math.PI * 2);
      // Updated color scheme: home pheromones match house (light blue), food pheromones match food (light green)
      ctx.fillStyle = p.type === 'home'
        ? `rgba(100,180,255,${p.strength})` // light blue for home pheromones
        : `rgba(120,255,120,${p.strength})`; // light green for food pheromones
      ctx.fill();
    }
  }
  // Draw ants (draw second, so food/home are on top)
  for (const ant of ants) {
    const antCanvas = toCanvasCoords(ant.x, ant.y);
    if (showDebug) {
      // Draw field of view (FOV) sector
      ctx.save();
      ctx.translate(antCanvas.x, antCanvas.y);
      ctx.rotate(ant.angle * Math.PI / 180);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(
        0,
        0,
        SENSE_RADIUS,
        (-SENSE_ANGLE / 2) * Math.PI / 180,
        (SENSE_ANGLE / 2) * Math.PI / 180
      );
      ctx.closePath();
      ctx.fillStyle = 'rgba(255,255,0,0.10)'; // light yellow, semi-transparent
      ctx.fill();
      ctx.restore();
    }
    // Draw ant
    ctx.save();
    ctx.translate(antCanvas.x, antCanvas.y);
    ctx.rotate(ant.angle * Math.PI / 180);
    ctx.beginPath();
    ctx.arc(0, 0, ANT_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = ant.hasFood ? '#fa0' : '#222';
    ctx.fill();
    ctx.strokeStyle = '#000';
    ctx.stroke();
    if (showDebug) {
      ctx.rotate(-ant.angle * Math.PI / 180); // Undo rotation for text
      ctx.font = '10px sans-serif';
      ctx.fillStyle = 'yellow';
      const x = Math.round(ant.x);
      const y = Math.round(ant.y);
      const angle = Math.round(ant.angle);
      ctx.fillText(`(${x},${y}) θ:${angle}°`, -18, ANT_RADIUS + 12);
    }
    ctx.restore();
  }
  // Draw food sources (draw on top of ants)
  for (const food of foodSources) {
    if (food.amount > 0) {
      const foodCanvas = toCanvasCoords(food.x, food.y);
      // Make radius proportional to food amount (minimum radius = 6, max = 2 * FOOD_RADIUS)
      const minRadius = 6;
      const maxRadius = 2 * FOOD_RADIUS;
      const radius = minRadius + (maxRadius - minRadius) * (food.amount / FOOD_AMOUNT);
      ctx.beginPath();
      ctx.arc(foodCanvas.x, foodCanvas.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = '#9f9'; // light green for food
      ctx.fill();
      ctx.strokeStyle = '#393';
      ctx.stroke();
      // Centered food amount, font size scales with radius
      ctx.fillStyle = '#222';
      ctx.font = `bold ${Math.round(radius * 0.95)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${food.amount}`, foodCanvas.x, foodCanvas.y);
    }
  }
  // Draw home (draw last, always on top)
  const homeCanvas = toCanvasCoords(home.x, home.y);
  ctx.beginPath();
  ctx.arc(homeCanvas.x, homeCanvas.y, HOME_RADIUS, 0, Math.PI * 2);
  ctx.fillStyle = '#8cf'; // light blue for home
  ctx.fill();
  ctx.strokeStyle = '#39a';
  ctx.stroke();
  // Centered foodDeposited, font size scales with home radius
  ctx.fillStyle = '#333';
  ctx.font = `bold ${Math.round(HOME_RADIUS * 1.1)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${home.foodDeposited}`, homeCanvas.x, homeCanvas.y);
}

function updateAnts() { 
  for (const ant of ants) {
    // Forget memory after a while
    if (ant.memory.forgetTimer > 0) {
      ant.memory.forgetTimer--;
      if (ant.memory.forgetTimer === 0) {
        ant.memory.home = undefined;
        ant.memory.food = undefined;
      }
    }
    const searchType = ant.hasFood ? 'home' : 'food';
    // 1. If ant has food and home is in FOV, turn toward home (priority)
    let didPriorityTurn = false;
    if (ant.hasFood) {
      const dxHome = home.x - ant.x;
      const dyHome = home.y - ant.y;
      const distHome = Math.hypot(dxHome, dyHome);
      if (distHome <= SENSE_RADIUS) {
        let angleToHome = Math.atan2(dyHome, dxHome) * (180 / Math.PI);
        const normalize = (a: number) => (a + 360) % 360;
        const antAngleNorm = normalize(ant.angle);
        const angleToHomeNorm = normalize(angleToHome);
        let diff = angleToHomeNorm - antAngleNorm;
        if (diff > 180) diff -= 360;
        if (diff < -180) diff += 360;
        if (Math.abs(diff) <= SENSE_ANGLE / 2) {
          // Instantly set angle toward home
          ant.angle = angleToHomeNorm;
          didPriorityTurn = true;
          // Always refresh home memory if ant does NOT remember food
          if (!ant.memory.food) {
            ant.memory.home = { x: home.x, y: home.y };
            ant.memory.forgetTimer = MEMORY_DURATION;
          }
        }
      }
    } else {
      // 2. If ant does not have food, check if any food is in FOV (priority)
      let closestFood: FoodSource | null = null;
      let closestDist = Infinity;
      let angleToClosestFood = 0;
      for (const food of foodSources) {
        if (food.amount > 0) {
          const dxFood = food.x - ant.x;
          const dyFood = food.y - ant.y;
          const distFood = Math.hypot(dxFood, dyFood);
          if (distFood <= SENSE_RADIUS) {
            let angleToFood = Math.atan2(dyFood, dxFood) * (180 / Math.PI);
            const normalize = (a: number) => (a + 360) % 360;
            const antAngleNorm = normalize(ant.angle);
            const angleToFoodNorm = normalize(angleToFood);
            let diff = angleToFoodNorm - antAngleNorm;
            if (diff > 180) diff -= 360;
            if (diff < -180) diff += 360;
            if (Math.abs(diff) <= SENSE_ANGLE / 2 && distFood < closestDist) {
              closestDist = distFood;
              closestFood = food;
              angleToClosestFood = angleToFoodNorm;
            }
          }
        }
      }
      if (closestFood) {
        ant.angle = angleToClosestFood;
        didPriorityTurn = true;
      }
    }

    // Drop pheromone if ant remembers food or home
    if (Math.random() < PHEROMONE_DROP_RATE) {
      // Drop food pheromone if ant remembers food
      if (ant.memory.food && ant.memory.forgetTimer > 0) {
        const foodMemoryStrength = ant.memory.forgetTimer / MEMORY_DURATION;
        const radius = 6;
        let merged = false;
        for (const p of pheromones) {
          if (p.type === 'food' && Math.hypot(p.x - ant.x, p.y - ant.y) < radius) {
            p.strength += foodMemoryStrength;
            merged = true;
            break;
          }
        }
        if (!merged) {
          pheromones.push({
            x: ant.x,
            y: ant.y,
            strength: foodMemoryStrength,
            type: 'food'
          });
        }
      }
      // Drop home pheromone if ant remembers home
      if (ant.memory.home && ant.memory.forgetTimer > 0) {
        const homeMemoryStrength = ant.memory.forgetTimer / MEMORY_DURATION;
        const radius = 6;
        let merged = false;
        for (const p of pheromones) {
          if (p.type === 'home' && Math.hypot(p.x - ant.x, p.y - ant.y) < radius) {
            p.strength += homeMemoryStrength;
            merged = true;
            break;
          }
        }
        if (!merged) {
          pheromones.push({
            x: ant.x,
            y: ant.y,
            strength: homeMemoryStrength,
            type: 'home'
          });
        }
      }
    }

    // 3. If not following food/home, follow pheromones
    let followingPheromone = false;
    // --- MODIFIED PHEROMONE FOLLOWING LOGIC ---
    // Ignore pheromone paths if ant has food and home is in FOV
    let homeInFOV = false;
    if (ant.hasFood) {
      const dxHome = home.x - ant.x;
      const dyHome = home.y - ant.y;
      const distHome = Math.hypot(dxHome, dyHome);
      if (distHome <= SENSE_RADIUS) {
        let angleToHome = Math.atan2(dyHome, dxHome) * (180 / Math.PI);
        const normalize = (a: number) => (a + 360) % 360;
        const antAngleNorm = normalize(ant.angle);
        const angleToHomeNorm = normalize(angleToHome);
        let diff = angleToHomeNorm - antAngleNorm;
        if (diff > 180) diff -= 360;
        if (diff < -180) diff += 360;
        if (Math.abs(diff) <= SENSE_ANGLE / 2) {
          homeInFOV = true;
        }
      }
    }
    // Ignore pheromone paths if ant does not have food and food is in FOV
    let foodInFOV = false;
    if (!ant.hasFood) {
      for (const food of foodSources) {
        if (food.amount > 0) {
          const dxFood = food.x - ant.x;
          const dyFood = food.y - ant.y;
          const distFood = Math.hypot(dxFood, dyFood);
          if (distFood <= SENSE_RADIUS) {
            let angleToFood = Math.atan2(dyFood, dxFood) * (180 / Math.PI);
            const normalize = (a: number) => (a + 360) % 360;
            const antAngleNorm = normalize(ant.angle);
            const angleToFoodNorm = normalize(angleToFood);
            let diff = angleToFoodNorm - antAngleNorm;
            if (diff > 180) diff -= 360;
            if (diff < -180) diff += 360;
            if (Math.abs(diff) <= SENSE_ANGLE / 2) {
              foodInFOV = true;
              break;
            }
          }
        }
      }
    }
    // Only follow pheromones if not ignoring due to FOV
    if (!homeInFOV && !foodInFOV) {
      if (ant.followingPheromone && ant.lastPheromoneType === searchType) {
        const sensed = pheromones.filter(p => p.type === searchType && isInView(ant.x, ant.y, ant.angle, p.x, p.y, SENSE_ANGLE, SENSE_RADIUS));
        if (sensed.length > 0) {
          // Pick the strongest pheromone in range
          let strongest = sensed[0];
          for (const p of sensed) {
            if (p.strength > strongest.strength) strongest = p;
          }
          // Calculate angle to strongest pheromone
          const dx = strongest.x - ant.x;
          const dy = strongest.y - ant.y;
          let targetAngle = Math.atan2(dy, dx) * (180 / Math.PI);
          // Add some error
          targetAngle += randomBetween(-PHEROMONE_ERROR * 180, PHEROMONE_ERROR * 180);
          ant.angle = targetAngle;
          followingPheromone = true;
        } else {
          // Lost the trail, stop following
          ant.followingPheromone = false;
          ant.lastPheromoneType = undefined;
        }
      } else if (!didPriorityTurn) {
        // Not currently following, try to acquire a pheromone trail
        const sensed = pheromones.filter(p => p.type === searchType && isInView(ant.x, ant.y, ant.angle, p.x, p.y, SENSE_ANGLE, SENSE_RADIUS));
        if (sensed.length > 0) {
          let strongest = sensed[0];
          for (const p of sensed) {
            if (p.strength > strongest.strength) strongest = p;
          }
          const dx = strongest.x - ant.x;
          const dy = strongest.y - ant.y;
          let targetAngle = Math.atan2(dy, dx) * (180 / Math.PI);
          targetAngle += randomBetween(-PHEROMONE_ERROR * 180, PHEROMONE_ERROR * 180);
          ant.angle = targetAngle;
          followingPheromone = true;
          ant.followingPheromone = true;
          ant.lastPheromoneType = searchType;
        } else if (ant.lookAroundTimer > 0 && ant.memory && ant.memory.forgetTimer > 0) {
          // If just picked up or dropped food and no pheromone, turn back to where it came from
          // Reverse direction
          ant.angle = (ant.angle + 180) % 360;
          ant.lookAroundTimer = 0; // End look around
        }
      }
    } else {
      // If ignoring pheromones, stop following
      ant.followingPheromone = false;
      ant.lastPheromoneType = undefined;
    }

    // Check if ant is inside any obstacle (not just about to move in)
    let insideObstacle = null;
    for (const obs of obstacles) {
      const dist = Math.hypot(ant.x - obs.x, ant.y - obs.y);
      if (dist < obs.radius + ANT_RADIUS - 1) { // -1 for tolerance
        insideObstacle = obs;
        break;
      }
    }
    if (insideObstacle) {
      // Move ant outward from obstacle center
      const dx = ant.x - insideObstacle.x;
      const dy = ant.y - insideObstacle.y;
      const dist = Math.hypot(dx, dy) || 1;
      // Nudge ant just outside the obstacle
      ant.x = insideObstacle.x + (dx / dist) * (insideObstacle.radius + ANT_RADIUS + 1);
      ant.y = insideObstacle.y + (dy / dist) * (insideObstacle.radius + ANT_RADIUS + 1);
      // Turn away from obstacle
      ant.angle = Math.atan2(dy, dx) * (180 / Math.PI) + randomBetween(-60, 60);
      continue; // Skip rest of logic for this ant this frame
    }

    // Only randomize direction if not following pheromones or food/home
    if (!didPriorityTurn && !followingPheromone && !ant.followingPheromone) {
      ant.directionChangeTimer--;
      if (ant.directionChangeTimer <= 0) {
        ant.angle = addAngle(ant.angle, randomBetween(-30, 30));
        ant.directionChangeTimer = Math.floor(Math.random() * 60) + 20; // reset timer
      }
    }

    // Check for food pickup
    if (!ant.hasFood) {
      for (const food of foodSources) {
        if (food.amount > 0) {
          const dx = ant.x - food.x;
          const dy = ant.y - food.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < ANT_RADIUS + FOOD_RADIUS) {
            ant.hasFood = true;
            food.amount--;
            ant.memory.food = { x: food.x, y: food.y };
            ant.memory.home = undefined;
            ant.memory.forgetTimer = MEMORY_DURATION;
            ant.lookAroundTimer = 60; // look around for 60 frames after pickup
            break;
          }
        }
      }
    }

    // Check for food drop at home
    const dx = ant.x - home.x;
    const dy = ant.y - home.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < ANT_RADIUS + HOME_RADIUS) {
      if (ant.hasFood) {
        ant.hasFood = false;
        ant.memory.home = { x: home.x, y: home.y };
        ant.memory.food = undefined;
        ant.memory.forgetTimer = MEMORY_DURATION;
        ant.lookAroundTimer = 60; // look around for 60 frames after drop
        home.foodDeposited = (home.foodDeposited || 0) + 1;
      }
    }

    // Calculate intended next position
    const radians = ant.angle * (Math.PI / 180);
    let newX = ant.x + Math.cos(radians);
    let newY = ant.y + Math.sin(radians);
    // Boundaries in center-based coordinates
    if (newX < -CANVAS_WIDTH / 2 || newX > CANVAS_WIDTH / 2) {
      ant.angle = (ant.angle + 180) % 360;
      if (newX < -CANVAS_WIDTH / 2) { newX = -CANVAS_WIDTH / 2; }
      if (newX > CANVAS_WIDTH / 2) { newX = CANVAS_WIDTH / 2; }
    }
    if (newY < -CANVAS_HEIGHT / 2 || newY > CANVAS_HEIGHT / 2) {
      ant.angle = (ant.angle + 180) % 360;
      if (newY < -CANVAS_HEIGHT / 2) { newY = -CANVAS_HEIGHT / 2; }
      if (newY > CANVAS_HEIGHT / 2) { newY = CANVAS_HEIGHT / 2; }
    }
    // Obstacle collision: if new position is inside any obstacle, slide along the obstacle
    let collided = false;
    for (const obs of obstacles) {
      const dist = Math.hypot(newX - obs.x, newY - obs.y);
      if (dist < obs.radius + ANT_RADIUS) {
        // Compute vector from obstacle center to ant
        const dx = newX - obs.x;
        const dy = newY - obs.y;
        // Tangent directions (perpendicular to radius vector)
        const tangent1 = Math.atan2(dy, dx) + Math.PI / 2;
        const tangent2 = Math.atan2(dy, dx) - Math.PI / 2;
        // Convert current angle to radians
        const antAngleRad = ant.angle * Math.PI / 180;
        // Choose tangent closest to current direction
        const diff1 = Math.abs(Math.atan2(Math.sin(tangent1 - antAngleRad), Math.cos(tangent1 - antAngleRad)));
        const diff2 = Math.abs(Math.atan2(Math.sin(tangent2 - antAngleRad), Math.cos(tangent2 - antAngleRad)));
        let slideAngle;
        if (diff1 < diff2) {
          slideAngle = tangent1;
        } else {
          slideAngle = tangent2;
        }
        // Add a small random perturbation to avoid getting stuck
        slideAngle += randomBetween(-0.2, 0.2);
        ant.angle = slideAngle * 180 / Math.PI;
        collided = true;
        break;
      }
    }
    if (!collided) {
      ant.x = newX;
      ant.y = newY;
    }
  }
}

function isInView(x: number, y: number, angle: number, x1: number, y1: number, viewAngle: number, d: number): boolean {
  // Calculate distance
  const dx = x1 - x;
  const dy = y1 - y;
  const dist = Math.hypot(dx, dy);
  if (dist > d) return false;

  // Calculate angle to P1
  let angleToP1 = Math.atan2(dy, dx) * (180 / Math.PI);
  // Normalize angles to [0, 360)
  const normalize = (a: number) => (a + 360) % 360;
  angle = normalize(angle);
  angleToP1 = normalize(angleToP1);

  // Find smallest difference
  let diff = Math.abs(angle - angleToP1);
  if (diff > 180) diff = 360 - diff;

  // Check if within view angle
  return diff <= (viewAngle / 2);
}

function addAngle(from: number, add: number): number {
  var newAngle = from + add;
  if (newAngle > 360) {
    newAngle = newAngle - 360;
  }

  if (newAngle < 0) {
    newAngle = 360 - newAngle;
  }

  return newAngle;
}

function randomBetween(start: number, end: number) {
  return Math.random() * (end - start) + start;
}

function updatePheromones() {
  for (const p of pheromones) {
    p.strength *= PHEROMONE_DECAY;
  }
  pheromones = pheromones.filter(p => p.strength > 0.05);
}

function animate(ctx: CanvasRenderingContext2D) {
  // Run simulation logic multiple times based on speed setting
  for (let i = 0; i < simulationSpeed; i++) {
    updateAnts();
    updatePheromones();
  }
  drawWorld(ctx);
  animationId = requestAnimationFrame(() => animate(ctx));
}

function startSimulation() {
  const numAnts = parseInt((document.getElementById('num-ants') as HTMLInputElement).value, 10);
  const numFood = parseInt((document.getElementById('num-food') as HTMLInputElement).value, 10);
  const numObstacles = parseInt((document.getElementById('num-obstacles') as HTMLInputElement).value, 10) || 0;
  resetSimulation(numAnts, numFood, numObstacles);
  const canvas = document.getElementById('sim-canvas') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d')!;
  if (animationId) cancelAnimationFrame(animationId);
  animate(ctx);
}

const startBtn = document.getElementById('start-sim') as HTMLButtonElement;
startBtn.addEventListener('click', startSimulation);

// Add event listener for adding food sources or obstacles interactively
const canvas = document.getElementById('sim-canvas') as HTMLCanvasElement;
canvas.addEventListener('click', async (event) => {
  // Get click position relative to canvas
  const rect = canvas.getBoundingClientRect();
  const canvasX = event.clientX - rect.left;
  const canvasY = event.clientY - rect.top;
  // Convert to simulation coordinates (center-based)
  const pos = fromCanvasCoords(canvasX, canvasY);
  // Ask user what to add
  const what = window.prompt('Add (f)ood or (o)bstacle? Enter f or o:', 'f');
  if (!what) return;
  if (what.toLowerCase() === 'f') {
    // Show prompt dialog for food size
    const sizeStr = window.prompt('Enter food size (any positive integer):', '60');
    if (sizeStr === null) return; // Cancelled
    const size = parseInt(sizeStr, 10);
    if (isNaN(size) || size < 1) return; // Invalid input
    // No upper clamp, allow any positive integer
    foodSources.push({ x: pos.x, y: pos.y, amount: size });
  } else if (what.toLowerCase() === 'o') {
    // Prompt for obstacle radius
    const radiusStr = window.prompt('Enter obstacle radius (20-80):', '30');
    if (radiusStr === null) return;
    const radius = parseInt(radiusStr, 10);
    if (isNaN(radius) || radius < 5 || radius > 120) return;
    obstacles.push({ x: pos.x, y: pos.y, radius });
  }
});
