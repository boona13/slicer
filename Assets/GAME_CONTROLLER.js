//  PERFECT SLICE – Game Controller
//  5-Slice Challenge: score-based rounds with grade + retry.
// ============================================================

// @input Component.ScriptComponent trimController {"label": "Trim Controller"}
// @input Component.Text scoreText     {"label": "Score Text"}
// @input Component.Text perfectText   {"label": "Perfect Text"}
// @input Component.Text streakText    {"label": "Streak Text"}
// @input Component.Text hintText      {"label": "Hint Text"}
// @input Component.Text roundText     {"label": "Round Text"}
// @input Component.Text resultsText   {"label": "Results Text"}
// @input Component.AudioComponent sliceAudio {"label": "Slice Sound"}
// @input SceneObject templateContainer {"label": "Template Container"}
// @input Component.Camera mainCamera  {"label": "Main Camera"}
// @input SceneObject flashOverlay     {"label": "Flash Overlay"}
// @input SceneObject shakeEffect      {"label": "Shake Effect"}

// @input float objectScale = 0.8 {"label": "Object Scale", "widget":"slider", "min":0.05, "max":3.0, "step":0.05}
// @input float spawnDistance = 80.0 {"label": "Spawn Distance", "widget":"slider", "min":30.0, "max":300.0, "step":5.0}
// @input float spinSpeed = 30.0 {"label": "Spin Speed", "widget":"slider", "min":0.0, "max":120.0, "step":5.0}
// @input float shatterForce = 40.0 {"label": "Shatter Force", "widget":"slider", "min":5.0, "max":150.0, "step":5.0}
// @input float shatterGravity = 120.0 {"label": "Shatter Gravity", "widget":"slider", "min":20.0, "max":300.0, "step":10.0}
// @input float shatterScale = 1.0 {"label": "Shatter Scale", "widget":"slider", "min":0.05, "max":3.0, "step":0.05}
// @input float shatterPieces = 40.0 {"label": "Shatter Pieces", "widget":"slider", "min":5.0, "max":80.0, "step":1.0}

// ----- Game State -----
var currentObject = null;
var currentMeshVisuals = [];
var templates = [];
var streak = 0;
var isSpawning = false;
var firstSlice = true;

// ----- Round / Score State -----
var MAX_ROUNDS = 5;
var currentRound = 0;       // 0 = not started, 1-5 = active rounds
var totalScore = 0;
var gameOver = false;        // true when showing results

// ----- Spawn Animation State -----
var spawnAnimating = false;
var spawnAnimTime = 0;
var SPAWN_ANIM_DURATION = 0.35;

// ----- Text Animation State -----
var textAnims = [];

// ----- Shatter State -----
var shatterPieces = [];
var SHATTER_DURATION = 2.2;
var SHATTER_MAX_PIECES = Math.round(script.shatterPieces);
var SHATTER_DRAG = 2.5;       // air resistance factor
var RESPAWN_DELAY = 1.8;
var PERFECT_MIN = 45;
var PERFECT_MAX = 55;

// ----- Screen Shake State -----
var shakeActive = false;
var shakeTime = 0;
var SHAKE_DURATION = 0.35;
// ----- Flash State -----
var flashActive = false;
var flashTime = 0;
var FLASH_DURATION = 0.25;
var flashObject = null;       // created at runtime

// ----- Tuning -----
var SPIN_SPEED = script.spinSpeed;
var SPAWN_DISTANCE = script.spawnDistance;
var OBJECT_SCALE = script.objectScale;
var SHATTER_FORCE = script.shatterForce;
var SHATTER_GRAVITY = script.shatterGravity;
var SHATTER_SCALE = script.shatterScale;

// ============================================================
//  SCORING – points per slice
// ============================================================
function scoreForPercent(pct) {
    if (pct >= PERFECT_MIN && pct <= PERFECT_MAX) return 100;  // Perfect
    if (pct >= 35 && pct <= 65) return 75;   // Great
    if (pct >= 20 && pct <= 70) return 50;   // Good
    if (pct >= 5  && pct <= 80) return 25;   // OK
    return 0;                                 // Bad
}

function gradeForScore(score) {
    if (score >= 500) return "S";
    if (score >= 400) return "A";
    if (score >= 300) return "B";
    if (score >= 200) return "C";
    return "D";
}

// ============================================================
//  INITIALIZATION
// ============================================================

script.createEvent("OnStartEvent").bind(function () {
    hideAllUI();

    // Gather templates
    if (script.templateContainer) {
        var count = script.templateContainer.getChildrenCount();
        for (var i = 0; i < count; i++) {
            var child = script.templateContainer.getChild(i);
            if (child) {
                child.enabled = false;
                templates.push(child);
            }
        }
        script.templateContainer.enabled = false;
        print("Found " + templates.length + " object templates.");
    } else {
        print("WARNING: No template container assigned!");
    }

    // Wire up trim callback
    if (script.trimController && script.trimController.api) {
        script.trimController.api.onTrimComplete = onTrimComplete;
    } else {
        print("WARNING: Trim Controller not assigned or has no API.");
    }


    // Set up flash overlay reference
    if (script.flashOverlay) {
        flashObject = script.flashOverlay;
        flashObject.enabled = false;
    }
    // Start the game
    startGame();
});

// ============================================================
//  GAME FLOW
// ============================================================

function startGame() {
    currentRound = 0;
    totalScore = 0;
    streak = 0;
    gameOver = false;
    firstSlice = true;

    hideAllUI();

    // Show hint
    if (script.hintText) {
        script.hintText.text = "Slice exactly 50%!";
        animateTextIn(script.hintText, "pop", 0.4);
    }

    // Spawn first object after short delay
    delayCall(0.5, function () {
        nextRound();
    });
}

function nextRound() {
    currentRound++;

    if (currentRound > MAX_ROUNDS) {
        showResults();
        return;
    }

    // Update round counter
    if (script.roundText) {
        script.roundText.text = currentRound + " / " + MAX_ROUNDS;
        if (currentRound === 1) {
            animateTextIn(script.roundText, "pop", 0.3);
        }
    }

    spawnRandomObject();
}

function showResults() {
    gameOver = true;
    setTrimEnabled(false);

    // Destroy any leftover object
    if (currentObject) {
        currentObject.destroy();
        currentObject = null;
        currentMeshVisuals = [];
    }

    // Hide round text
    if (script.roundText) animateTextOut(script.roundText, 0.25);

    // Build results display
    var grade = gradeForScore(totalScore);

    // Show score
    if (script.scoreText) {
        script.scoreText.text = totalScore + " / " + (MAX_ROUNDS * 100);
        animateTextIn(script.scoreText, "punch", 0.5);
    }

    // Show grade
    delayCall(0.3, function () {
        if (script.perfectText) {
            script.perfectText.text = "Grade: " + grade;
            animateTextIn(script.perfectText, "punch", 0.5);
        }
    });

    // Show results / retry prompt
    delayCall(0.6, function () {
        if (script.resultsText) {
            script.resultsText.text = "Tap to try again!";
            animateTextIn(script.resultsText, "pop", 0.35);
        }
    });
}

// ============================================================
//  RETRY – tap during results screen restarts the game
// ============================================================

script.createEvent("TapEvent").bind(function () {
    if (!gameOver) return;

    // Hide results UI
    if (script.scoreText)   animateTextOut(script.scoreText, 0.2);
    if (script.perfectText) animateTextOut(script.perfectText, 0.2);
    if (script.resultsText) animateTextOut(script.resultsText, 0.2);
    if (script.streakText)  animateTextOut(script.streakText, 0.2);

    delayCall(0.3, function () {
        startGame();
    });
});

// ============================================================
//  UPDATE – spin + spawn anim + text anims + shatter
// ============================================================

script.createEvent("UpdateEvent").bind(function (eventData) {
    var dt = eventData.getDeltaTime();

    // ---- Text animations ----
    updateTextAnims(dt);

    // ---- Screen shake ----
    // ---- Screen shake (post effect) ----
    if (shakeActive) {
        shakeTime += dt;
        if (shakeTime >= SHAKE_DURATION) {
            shakeActive = false;
            if (script.shakeEffect) script.shakeEffect.enabled = false;
        }
    }

    // ---- White flash ----
    if (flashActive && flashObject) {
        flashTime += dt;
        var ft = flashTime / FLASH_DURATION;
        if (ft >= 1.0) {
            flashActive = false;
            flashObject.enabled = false;
        } else {
            // Fast fade-out: opacity goes from 0.7 → 0
            var opacity = 0.7 * (1.0 - ft * ft);
            var img = flashObject.getComponent("Component.Image");
            if (img && img.mainMaterial) {
                img.mainMaterial.mainPass.baseColor = new vec4(1, 1, 1, opacity);
            }
        }
    }


    // ---- Shatter pieces animation ----
    for (var sp = shatterPieces.length - 1; sp >= 0; sp--) {
        var piece = shatterPieces[sp];
        piece.time += dt;
        var t = piece.time / piece.duration;

        if (t >= 1.0) {
            piece.sceneObj.destroy();
            shatterPieces.splice(sp, 1);
            continue;
        }

        // Gravity
        piece.velocity = piece.velocity.sub(new vec3(0, SHATTER_GRAVITY * dt, 0));

        // Air drag – exponential slowdown (heavier pieces resist more)
        var dragFactor = Math.max(0, 1.0 - SHATTER_DRAG * dt);
        piece.velocity = piece.velocity.uniformScale(dragFactor);

        // Move
        var pos = piece.sceneObj.getTransform().getWorldPosition();
        pos = pos.add(piece.velocity.uniformScale(dt));
        piece.sceneObj.getTransform().setWorldPosition(pos);

        // Spin (also decays with drag for realism)
        piece.angularVel = piece.angularVel.uniformScale(dragFactor);
        var rot = piece.sceneObj.getTransform().getLocalRotation();
        var spinQ = quat.fromEulerAngles(
            piece.angularVel.x * dt,
            piece.angularVel.y * dt,
            piece.angularVel.z * dt
        );
        piece.sceneObj.getTransform().setLocalRotation(rot.multiply(spinQ));

        // Smooth shrink in the last 30%
        if (t > 0.7) {
            var fade = 1.0 - ((t - 0.7) / 0.3);
            fade = fade * fade; // ease-in curve for smooth disappear
            var s = piece.baseScale * fade;
            piece.sceneObj.getTransform().setLocalScale(new vec3(s, s, s));
        }
    }

    // ---- Object ----
    if (!currentObject) return;
    if (!currentObject.enabled) return;

    // Spawn scale-in
    if (spawnAnimating) {
        spawnAnimTime += dt;
        var t2 = Math.min(spawnAnimTime / SPAWN_ANIM_DURATION, 1.0);
        var eased = 1.0 - Math.pow(1.0 - t2, 3);
        var s2 = OBJECT_SCALE * eased;
        currentObject.getTransform().setLocalScale(new vec3(s2, s2, s2));
        if (t2 >= 1.0) spawnAnimating = false;
        return;
    }

    // Spin
    if (!isSpawning) {
        var transform = currentObject.getTransform();
        var curRot = transform.getLocalRotation();
        var spinRad = SPIN_SPEED * dt * Math.PI / 180;
        var spinQuat = quat.fromEulerAngles(0, spinRad, 0);
        transform.setLocalRotation(curRot.multiply(spinQuat));
    }
});

// ============================================================
//  TEXT ANIMATION SYSTEM
// ============================================================

function animateTextIn(textComp, type, duration) {
    if (!textComp) return;
    var obj = textComp.getSceneObject();
    obj.enabled = true;
    obj.getTransform().setLocalScale(new vec3(0.01, 0.01, 0.01));
    textAnims.push({
        obj: obj,
        active: true,
        time: 0,
        duration: duration || 0.35,
        type: type || "pop"
    });
}

function animateTextOut(textComp, duration) {
    if (!textComp) return;
    var obj = textComp.getSceneObject();
    if (!obj.enabled) return;
    textAnims.push({
        obj: obj,
        active: true,
        time: 0,
        duration: duration || 0.2,
        type: "popOut"
    });
}

function updateTextAnims(dt) {
    for (var i = textAnims.length - 1; i >= 0; i--) {
        var a = textAnims[i];
        if (!a.active) { textAnims.splice(i, 1); continue; }

        a.time += dt;
        var t = Math.min(a.time / a.duration, 1.0);
        var scale = 1.0;

        if (a.type === "pop") {
            scale = easeOutBack(t);
        } else if (a.type === "punch") {
            scale = easeOutElastic(t);
        } else if (a.type === "popOut") {
            scale = 1.0 - easeInBack(t);
            if (scale < 0) scale = 0;
        }

        a.obj.getTransform().setLocalScale(new vec3(scale, scale, scale));

        if (t >= 1.0) {
            a.active = false;
            if (a.type === "popOut") {
                a.obj.enabled = false;
                a.obj.getTransform().setLocalScale(new vec3(1, 1, 1));
            }
            textAnims.splice(i, 1);
        }
    }
}

// Easing helpers
function easeOutBack(t) {
    var c1 = 1.70158;
    var c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

function easeInBack(t) {
    var c1 = 1.70158;
    var c3 = c1 + 1;
    return c3 * t * t * t - c1 * t * t;
}

function easeOutElastic(t) {
    if (t === 0 || t === 1) return t;
    var p = 0.4;
    return Math.pow(2, -10 * t) * Math.sin((t - p / 4) * (2 * Math.PI) / p) + 1;
}

// ============================================================
//  OBJECT SPAWNING
// ============================================================

function spawnRandomObject() {
    if (templates.length === 0) {
        print("ERROR: No object templates found!");
        return;
    }

    isSpawning = true;
    setTrimEnabled(false);

    var idx = Math.floor(Math.random() * templates.length);
    var template = templates[idx];

    currentObject = global.scene.createSceneObject("SliceTarget");
    var copiedChild = currentObject.copyWholeHierarchy(template);
    copiedChild.enabled = true;

    var displayName = template.name.replace("Template_", "");
    currentObject.name = displayName;

    if (script.mainCamera) {
        var camT = script.mainCamera.getTransform();
        var camPos = camT.getWorldPosition();
        var camFwd = camT.forward;
        var spawnPos = camPos.add(camFwd.uniformScale(-SPAWN_DISTANCE));
        currentObject.getTransform().setWorldPosition(spawnPos);
    }

    currentObject.getTransform().setLocalScale(new vec3(0.01, 0.01, 0.01));
    spawnAnimating = true;
    spawnAnimTime = 0;

    currentMeshVisuals = [];
    collectMeshVisuals(currentObject, currentMeshVisuals);

    if (script.trimController && script.trimController.api &&
        currentMeshVisuals.length > 0) {
        script.trimController.api.setTargetMeshes(currentMeshVisuals, []);
    }

    print("Round " + currentRound + "/" + MAX_ROUNDS +
          " – Spawned: " + currentObject.name +
          " (" + currentMeshVisuals.length + " mesh visuals)");

    delayCall(SPAWN_ANIM_DURATION + 0.1, function () {
        isSpawning = false;
        setTrimEnabled(true);
    });
}

function collectMeshVisuals(obj, out) {
    var visuals = obj.getComponents("Component.RenderMeshVisual");
    for (var i = 0; i < visuals.length; i++) {
        out.push(visuals[i]);
    }
    for (var c = 0; c < obj.getChildrenCount(); c++) {
        collectMeshVisuals(obj.getChild(c), out);
    }
}

// ============================================================
//  TRIM COMPLETE CALLBACK
// ============================================================

function onTrimComplete(stats) {
    if (gameOver) return;

    if (firstSlice) {
        firstSlice = false;
        if (script.hintText) animateTextOut(script.hintText, 0.2);
    }

    var pct = stats.percentRemoved;

    // ---- Sound ----
    if (script.sliceAudio) {
        script.sliceAudio.play(1);
    }

    // ---- Haptic + Screen effects ----
    triggerHaptic();
    triggerScreenShake();
    triggerFlash();

    // ---- Shatter VFX ----
    if (stats.removedTriangles && stats.removedTriangles.length > 0) {
        spawnShatterPieces(stats.removedTriangles);
    }

    // ---- Scoring ----
    var sliceScore = scoreForPercent(pct);
    totalScore += sliceScore;

    // ---- Determine feedback message ----
    var isPerfect = (pct >= PERFECT_MIN && pct <= PERFECT_MAX);
    var feedbackMsg = "";

    if (isPerfect) {
        streak++;
        feedbackMsg = "PERFECT! +" + sliceScore;
    } else if (sliceScore >= 75) {
        streak++;
        feedbackMsg = "Great! +" + sliceScore;
    } else if (sliceScore >= 50) {
        streak++;
        feedbackMsg = "Nice! +" + sliceScore;
    } else if (sliceScore >= 25) {
        streak = 0;
        feedbackMsg = "OK... +" + sliceScore;
    } else {
        streak = 0;
        feedbackMsg = "Miss! +0";
    }

    // ---- Staggered text animations ----
    // Score text
    if (script.scoreText) {
        script.scoreText.text = pct + "% Sliced!";
        animateTextIn(script.scoreText, "pop", 0.35);
    }

    // Feedback + points
    if (feedbackMsg.length > 0) {
        delayCall(0.2, function () {
            if (script.perfectText) {
                script.perfectText.text = feedbackMsg;
                animateTextIn(script.perfectText,
                    isPerfect ? "punch" : "pop",
                    isPerfect ? 0.5 : 0.35);
            }
        });
    }

    // Streak
    if (streak >= 2 && script.streakText) {
        delayCall(0.35, function () {
            if (script.streakText) {
                script.streakText.text = "Streak: " + streak;
                animateTextIn(script.streakText, "pop", 0.3);
            }
        });
    }

    setTrimEnabled(false);

    // ---- Animate out → next round ----
    delayCall(RESPAWN_DELAY - 0.4, function () {
        if (script.scoreText)   animateTextOut(script.scoreText, 0.25);
        if (script.perfectText) animateTextOut(script.perfectText, 0.25);
        if (script.streakText)  animateTextOut(script.streakText, 0.25);
    });

    delayCall(RESPAWN_DELAY, function () {
        if (currentObject) {
            currentObject.destroy();
            currentObject = null;
            currentMeshVisuals = [];
        }
        nextRound();
    });
}

// ============================================================
//  UI HELPERS
// ============================================================

function hideAllUI() {
    if (script.scoreText)   { script.scoreText.getSceneObject().enabled = false; }
    if (script.perfectText) { script.perfectText.getSceneObject().enabled = false; }
    if (script.streakText)  { script.streakText.getSceneObject().enabled = false; }
    if (script.hintText)    { script.hintText.getSceneObject().enabled = false; }
    if (script.roundText)   { script.roundText.getSceneObject().enabled = false; }
    if (script.resultsText) { script.resultsText.getSceneObject().enabled = false; }
}

// ============================================================
//  UTILITY
// ============================================================

function setTrimEnabled(enabled) {
    if (script.trimController && script.trimController.api) {
        script.trimController.api.setTrimEnabled(enabled);
    }
}

function triggerHaptic() {
    try {
        if (global.hapticFeedbackSystem) {
            global.hapticFeedbackSystem.hapticFeedback(
                HapticFeedbackType.TapticEngine
            );
        }
    } catch (e) {}
}


function triggerScreenShake() {
    if (!script.shakeEffect) return;
    script.shakeEffect.enabled = true;
    shakeActive = true;
    shakeTime = 0;
}

function triggerFlash() {
    if (!flashObject) return;
    flashObject.enabled = true;
    flashActive = true;
    flashTime = 0;
    // Set initial bright flash
    var img = flashObject.getComponent("Component.Image");
    if (img && img.mainMaterial) {
        img.mainMaterial.mainPass.baseColor = new vec4(1, 1, 1, 0.7);
    }
}

// ============================================================
//  SHATTER SYSTEM
// ============================================================


function spawnShatterPieces(removedTris) {
    var numTris = removedTris.length;
    if (numTris === 0) return;

    // If too many triangles, randomly sample down to the cap
    var trisToUse = removedTris;
    if (numTris > SHATTER_MAX_PIECES) {
        // Shuffle and take first N
        for (var si = numTris - 1; si > 0; si--) {
            var sj = Math.floor(Math.random() * (si + 1));
            var tmp = removedTris[si];
            removedTris[si] = removedTris[sj];
            removedTris[sj] = tmp;
        }
        trisToUse = removedTris.slice(0, SHATTER_MAX_PIECES);
    }

    // Overall centroid for radial component
    var overallCenter = new vec3(0, 0, 0);
    for (var ci = 0; ci < trisToUse.length; ci++) {
        var tri = trisToUse[ci];
        overallCenter = overallCenter.add(tri[0]).add(tri[1]).add(tri[2]);
    }
    overallCenter = overallCenter.uniformScale(1.0 / (trisToUse.length * 3));

    // Spawn one piece per triangle
    for (var p = 0; p < trisToUse.length; p++) {
        var tr = trisToUse[p];

        // Triangle centroid
        var centroid = tr[0].add(tr[1]).add(tr[2]).uniformScale(1.0 / 3.0);

        // Face normal
        var edge1 = tr[1].sub(tr[0]);
        var edge2 = tr[2].sub(tr[0]);
        var faceNormal = edge1.cross(edge2);
        if (faceNormal.length > 0.0001) {
            faceNormal = faceNormal.normalize();
        } else {
            faceNormal = vec3.randomDirection();
        }

        // Build mesh for this single triangle (local to centroid)
        // Build mesh for this single triangle (local to centroid)
        var pieceVerts = [];
        var pieceIndices = [0, 1, 2];

        for (var vi = 0; vi < 3; vi++) {
            var lp = tr[vi].sub(centroid);
            pieceVerts.push(lp.x, lp.y, lp.z);
            pieceVerts.push(faceNormal.x, faceNormal.y, faceNormal.z);
            pieceVerts.push(0, 0);
        }

        var builder = new MeshBuilder([
            { name: "position",  components: 3 },
            { name: "normal",    components: 3, normalized: true },
            { name: "texture0",  components: 2 }
        ]);
        builder.topology = MeshTopology.Triangles;
        builder.indexType = MeshIndexType.UInt16;
        builder.appendVerticesInterleaved(pieceVerts);
        builder.appendIndices(pieceIndices);

        if (!builder.isValid()) continue;

        var mesh = builder.getMesh();
        builder.updateMesh();

        // Create piece SceneObject
        var pieceObj = global.scene.createSceneObject("ShatterPiece");
        pieceObj.getTransform().setWorldPosition(centroid);
        pieceObj.getTransform().setLocalScale(new vec3(SHATTER_SCALE, SHATTER_SCALE, SHATTER_SCALE));

        var rmv = pieceObj.createComponent("Component.RenderMeshVisual");
        rmv.mesh = mesh;

        if (currentMeshVisuals.length > 0 && currentMeshVisuals[0].mainMaterial) {
            rmv.mainMaterial = currentMeshVisuals[0].mainMaterial;
        }

        // --- Velocity ---
        // Primary direction: face normal (pieces fly off the surface)
        // Secondary: radial outward from overall center
        var radialDir = centroid.sub(overallCenter);
        if (radialDir.length < 0.001) {
            radialDir = vec3.randomDirection();
        } else {
            radialDir = radialDir.normalize();
        }

        // Blend: 60% face normal + 40% radial outward
        var blendedDir = faceNormal.uniformScale(0.6).add(radialDir.uniformScale(0.4));
        // Add small random jitter for natural variation
        var jitter = vec3.randomDirection().uniformScale(0.15);
        blendedDir = blendedDir.add(jitter).normalize();

        // Varied force: some pieces fly fast, some barely move
        var forceMult = 0.3 + Math.random() * 1.0;  // 0.3x to 1.3x
        var velocity = blendedDir.uniformScale(SHATTER_FORCE * forceMult);

        // Slight upward kick (so pieces arc naturally)
        velocity = velocity.add(new vec3(0, SHATTER_FORCE * 0.15 * Math.random(), 0));

        // --- Angular velocity ---
        // Smaller pieces spin faster (inverse of triangle size)
        var triSize = edge1.cross(edge2).length * 0.5;  // area
        var spinMult = triSize < 0.01 ? 15 : (triSize < 0.1 ? 10 : 6);
        var angVel = new vec3(
            (Math.random() - 0.5) * spinMult,
            (Math.random() - 0.5) * spinMult,
            (Math.random() - 0.5) * spinMult
        );

        // --- Duration: stagger so pieces don't all vanish at once ---
        var dur = SHATTER_DURATION * (0.6 + Math.random() * 0.6);

        shatterPieces.push({
            sceneObj: pieceObj,
            velocity: velocity,
            angularVel: angVel,
            time: 0,
            duration: dur,
            baseScale: SHATTER_SCALE
        });
    }

    print("Shatter: " + trisToUse.length + " pieces from " + numTris + " triangles");
}

// ============================================================
//  DELAY HELPER
// ============================================================

function delayCall(seconds, callback) {
    var ev = script.createEvent("DelayedCallbackEvent");
    ev.bind(callback);
    ev.reset(seconds);
    return ev;
}
