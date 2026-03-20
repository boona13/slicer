// @input Component.Camera camera
// @input Asset.Texture uvTexture
// @input Component.Camera camera {"label":"Camera"}
// @input SceneObject trimOverlay {"label":"Trim Overlay (2D)"}
// @input Component.RenderMeshVisual[] targetMeshes {"label": "Target Meshes"}
// @input Physics.ColliderComponent[] colliders {"label": "Mesh Colliders"}
// @input bool useColliders = true {"label": "Update Mesh Colliders"}

var isDragging = false;
var startTouchPos;
var boxPoints = [];
var meshDataArray = [];
var trimEnabled = true;

// Numerical tolerance for floating-point comparisons
var EPSILON = 1e-6;
// Minimum screen-space triangle area to avoid degenerate geometry
var MIN_TRI_AREA_SQ = 1e-12;

// ============================================================
//  PUBLIC API  (accessible by other scripts via script.api)
// ============================================================

// Callback fired after every trim: function(stats)
// stats = { percentRemoved: Number, verticesBefore: Number, verticesAfter: Number }
script.api.onTrimComplete = null;

// Enable / disable trimming (used during spawn animations etc.)
script.api.setTrimEnabled = function (enabled) {
    trimEnabled = enabled;
};

// Re-initialise mesh data (call after swapping target meshes at runtime)
script.api.reinitMeshData = function () {
    meshDataArray = [];
    for (var i = 0; i < script.targetMeshes.length; i++) {
        storeMeshData(i);
    }
};

// Allow the game controller to replace target meshes at runtime
script.api.setTargetMeshes = function (meshes, colliderArray) {
    script.targetMeshes = meshes;
    if (colliderArray) {
        script.colliders = colliderArray;
    }
    script.api.reinitMeshData();
};

// ============================================================
//  INITIALIZATION
// ============================================================

script.createEvent("OnStartEvent").bind(function () {
    if (!validateInputs()) return;

    // Hide the 2D trim overlay at start
    if (script.trimOverlay) {
        script.trimOverlay.enabled = false;
    }

    for (var i = 0; i < script.targetMeshes.length; i++) {
        storeMeshData(i);
    }
});

function storeMeshData(meshIndex) {
    var targetMesh = script.targetMeshes[meshIndex];
    if (!targetMesh || !targetMesh.mesh) return;

    var positions = targetMesh.mesh.extractVerticesForAttribute("position");
    var normals   = targetMesh.mesh.extractVerticesForAttribute("normal");
    var uvs       = targetMesh.mesh.extractVerticesForAttribute("texture0");

    var meshData = {
        vertexData: [],
        indices: [],
        stride: 8 // position(3) + normal(3) + uv(2)
    };

    for (var i = 0; i < positions.length / 3; i++) {
        meshData.vertexData.push(
            positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2],
            normals[i * 3],   normals[i * 3 + 1],   normals[i * 3 + 2],
            uvs[i * 2],       uvs[i * 2 + 1]
        );
    }

    meshData.indices = targetMesh.mesh.extractIndices();
    meshDataArray[meshIndex] = meshData;
    print("Stored mesh " + meshIndex + " data: " +
          meshData.vertexData.length / meshData.stride + " vertices");
}

// ============================================================
//  BOX INDICATOR (2D ScreenTransform overlay)
// ============================================================

// Convert touch coordinates to ScreenTransform anchor values.
// Touch: (0,0) = top-left,   (1,1) = bottom-right
// Anchor: (-1,-1) = bottom-left, (1,1) = top-right
function touchToAnchorX(tx) { return tx * 2 - 1; }
function touchToAnchorY(ty) { return (1 - ty) * 2 - 1; }

function updateBoxIndicator(start, end) {
    var minX = Math.min(start.x, end.x);
    var maxX = Math.max(start.x, end.x);
    var minY = Math.min(start.y, end.y);
    var maxY = Math.max(start.y, end.y);

    // Update the 2D overlay position via ScreenTransform anchors
    if (script.trimOverlay) {
        var st = script.trimOverlay.getComponent("Component.ScreenTransform");
        if (st) {
            st.anchors.left   = touchToAnchorX(minX);
            st.anchors.right  = touchToAnchorX(maxX);
            st.anchors.top    = touchToAnchorY(minY);  // small touchY = top of screen = high anchor
            st.anchors.bottom = touchToAnchorY(maxY);  // large touchY = bottom of screen = low anchor
            // Zero out offsets so anchors fully control position
            st.offsets.left   = 0;
            st.offsets.right  = 0;
            st.offsets.top    = 0;
            st.offsets.bottom = 0;
        }
    }

    // Store box in touch-space for the trimming algorithm
    boxPoints = [
        new vec2(minX, minY),
        new vec2(maxX, minY),
        new vec2(maxX, maxY),
        new vec2(minX, maxY)
    ];
}

// ============================================================
//  VERTEX DATA HELPERS
// ============================================================

// Extract the full interleaved data for one vertex as a plain array
function getVertexArray(meshData, vertexIndex) {
    var start = vertexIndex * meshData.stride;
    var arr = [];
    for (var i = 0; i < meshData.stride; i++) {
        arr.push(meshData.vertexData[start + i]);
    }
    return arr;
}

// Linearly interpolate two vertex-data arrays and re-normalise the normal
function lerpVertexArrays(a, b, t, stride) {
    var result = [];
    for (var i = 0; i < stride; i++) {
        result.push(a[i] + (b[i] - a[i]) * t);
    }
    // Re-normalise the interpolated normal (components 3, 4, 5)
    var nx = result[3], ny = result[4], nz = result[5];
    var len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (len > EPSILON) {
        result[3] /= len;
        result[4] /= len;
        result[5] /= len;
    }
    return result;
}

// Project a vertex-data array to screen space via the camera
function vertexToScreen(vData, objTransform) {
    var localPos = new vec3(vData[0], vData[1], vData[2]);
    var worldPos = objTransform.getWorldTransform().multiplyPoint(localPos);
    return script.camera.worldSpaceToScreenSpace(worldPos);
}

// Build a "clip vertex" object used by the polygon clipper
function makeClipVertex(vData, screenPos) {
    return { data: vData, screen: screenPos };
}

// Interpolate two clip vertices and produce a new one
function lerpClipVertex(a, b, t, stride) {
    return {
        data: lerpVertexArrays(a.data, b.data, t, stride),
        screen: new vec2(
            a.screen.x + (b.screen.x - a.screen.x) * t,
            a.screen.y + (b.screen.y - a.screen.y) * t
        )
    };
}

// ============================================================
//  SUTHERLAND-HODGMAN POLYGON CLIPPING
//
//  Clips a convex polygon against ONE half-plane defined by:
//      axis='x'|'y'   threshold=number   keepAbove=bool
//
//  keepAbove = true  → keep the side where value >= threshold
//  keepAbove = false → keep the side where value <= threshold
//
//  Returns { kept: [...], rejected: [...] }
//  Both are arrays of clip-vertex objects forming convex polygons
//  (empty array if nothing on that side).
// ============================================================

function clipAgainstEdge(polygon, axis, threshold, keepAbove, stride) {
    if (polygon.length < 3) {
        return { kept: polygon.slice(), rejected: [] };
    }

    var kept = [];
    var rejected = [];
    var n = polygon.length;

    for (var i = 0; i < n; i++) {
        var curr = polygon[i];
        var next = polygon[(i + 1) % n];

        var currVal = (axis === "x") ? curr.screen.x : curr.screen.y;
        var nextVal = (axis === "x") ? next.screen.x : next.screen.y;

        var currIn = keepAbove ? (currVal >= threshold) : (currVal <= threshold);
        var nextIn = keepAbove ? (nextVal >= threshold) : (nextVal <= threshold);

        if (currIn && nextIn) {
            // Both on kept side
            kept.push(next);
        } else if (currIn && !nextIn) {
            // Exiting kept side
            var denom = nextVal - currVal;
            var t = (Math.abs(denom) > EPSILON) ?
                    Math.max(0, Math.min(1, (threshold - currVal) / denom)) : 0;
            var interp = lerpClipVertex(curr, next, t, stride);
            kept.push(interp);
            // Clone for rejected side so arrays stay independent
            var interpR = lerpClipVertex(curr, next, t, stride);
            rejected.push(interpR);
            rejected.push(next);
        } else if (!currIn && nextIn) {
            // Entering kept side
            var denom = nextVal - currVal;
            var t = (Math.abs(denom) > EPSILON) ?
                    Math.max(0, Math.min(1, (threshold - currVal) / denom)) : 0;
            var interpR2 = lerpClipVertex(curr, next, t, stride);
            rejected.push(interpR2);
            var interpK = lerpClipVertex(curr, next, t, stride);
            kept.push(interpK);
            kept.push(next);
        } else {
            // Both on rejected side
            rejected.push(next);
        }
    }

    return { kept: kept, rejected: rejected };
}

// ============================================================
//  CLIP TRIANGLE OUTSIDE BOX
//
//  Given a triangle (as 3 clip-vertex objects), returns an array
//  of triangles [v0data, v1data, v2data] that lie OUTSIDE the
//  axis-aligned box { minX, maxX, minY, maxY }.
//
//  Algorithm:
//    Sequentially clip the polygon against the 4 box edges.
//    At each step the "rejected" piece is a convex polygon on the
//    OUTSIDE of that edge → fan-triangulate and collect it.
//    After all 4 clips the remainder is inside the box → discard.
// ============================================================

function clipTriangleOutsideBox(triClipVerts, box, stride) {
    var output = [];
    var current = triClipVerts;

    // Order matters: left, right, bottom, top
    var edges = [
        { axis: "x", threshold: box.minX, keepAbove: true  }, // keep x >= minX
        { axis: "x", threshold: box.maxX, keepAbove: false }, // keep x <= maxX
        { axis: "y", threshold: box.minY, keepAbove: true  }, // keep y >= minY
        { axis: "y", threshold: box.maxY, keepAbove: false }  // keep y <= maxY
    ];

    for (var e = 0; e < edges.length; e++) {
        if (current.length < 3) break;

        var result = clipAgainstEdge(
            current,
            edges[e].axis,
            edges[e].threshold,
            edges[e].keepAbove,
            stride
        );

        // Rejected = outside this edge of the box → keep as output geometry
        if (result.rejected.length >= 3) {
            fanTriangulate(result.rejected, output);
        }

        // Remainder continues to next clip edge
        current = result.kept;
    }

    // 'current' is now the polygon fully inside the box → discard it
    return output;
}

// Fan-triangulate a convex polygon into triangle data arrays
function fanTriangulate(polygon, outputList) {
    for (var i = 1; i < polygon.length - 1; i++) {
        // Quick degenerate-triangle check in screen space
        if (!isTriangleLargeEnough(
                polygon[0].screen,
                polygon[i].screen,
                polygon[i + 1].screen)) {
            continue;
        }
        outputList.push([
            polygon[0].data,
            polygon[i].data,
            polygon[i + 1].data
        ]);
    }
}

// Returns true if screen-space triangle has non-negligible area
function isTriangleLargeEnough(a, b, c) {
    // Twice the signed area via cross product
    var cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    return (cross * cross) > MIN_TRI_AREA_SQ;
}

// ============================================================
//  MAIN TRIM FUNCTION  (precise clipping version)
// ============================================================

function performTrim() {
    if (!trimEnabled) return;
    if (!script.targetMeshes || boxPoints.length !== 4) return;

    // Track surface area for accurate percentage calculation
    var totalAreaBefore = 0;
    var totalAreaAfter  = 0;
    var removedTris     = [];  // world-space triangles for shatter effect

    // Compute axis-aligned box in screen space
    var box = {
        minX: Math.min(boxPoints[0].x, boxPoints[2].x),
        maxX: Math.max(boxPoints[0].x, boxPoints[2].x),
        minY: Math.min(boxPoints[0].y, boxPoints[2].y),
        maxY: Math.max(boxPoints[0].y, boxPoints[2].y)
    };

    // Skip tiny accidental taps
    if ((box.maxX - box.minX) < 0.005 && (box.maxY - box.minY) < 0.005) return;

    for (var meshIndex = 0; meshIndex < script.targetMeshes.length; meshIndex++) {
        var targetMesh = script.targetMeshes[meshIndex];
        var meshData   = meshDataArray[meshIndex];

        // Grab the matching collider if available (gracefully handle
        // fewer colliders than meshes — just skip collider update for
        // meshes that don't have one assigned)
        var collider = null;
        if (script.useColliders && script.colliders &&
            meshIndex < script.colliders.length) {
            collider = script.colliders[meshIndex];
        }

        if (!targetMesh || !meshData) continue;

        var objTransform = targetMesh.getTransform();
        var stride       = meshData.stride;

        var newVertices  = [];
        var newIndices   = [];
        var vertexCount  = 0;

        // World transform for converting removed vertices to world space
        var worldMat = objTransform.getWorldTransform();

        for (var i = 0; i < meshData.indices.length; i += 3) {
            var idx0 = meshData.indices[i];
            var idx1 = meshData.indices[i + 1];
            var idx2 = meshData.indices[i + 2];

            // Extract full vertex data
            var v0 = getVertexArray(meshData, idx0);
            var v1 = getVertexArray(meshData, idx1);
            var v2 = getVertexArray(meshData, idx2);

            // Compute this triangle's area (local-space) for scoring
            var p0 = new vec3(v0[0], v0[1], v0[2]);
            var p1 = new vec3(v1[0], v1[1], v1[2]);
            var p2 = new vec3(v2[0], v2[1], v2[2]);
            var triArea = p1.sub(p0).cross(p2.sub(p0)).length * 0.5;
            totalAreaBefore += triArea;

            // Project to screen space
            var s0 = vertexToScreen(v0, objTransform);
            var s1 = vertexToScreen(v1, objTransform);
            var s2 = vertexToScreen(v2, objTransform);

            // Fast path: if the screen-space bounding box of the triangle
            // doesn't overlap the selection box at all → keep triangle as-is
            var triMinX = Math.min(s0.x, s1.x, s2.x);
            var triMaxX = Math.max(s0.x, s1.x, s2.x);
            var triMinY = Math.min(s0.y, s1.y, s2.y);
            var triMaxY = Math.max(s0.y, s1.y, s2.y);

            if (triMaxX < box.minX || triMinX > box.maxX ||
                triMaxY < box.minY || triMinY > box.maxY) {
                // No overlap – keep entire triangle
                appendVertexData(newVertices, v0);
                appendVertexData(newVertices, v1);
                appendVertexData(newVertices, v2);
                newIndices.push(vertexCount, vertexCount + 1, vertexCount + 2);
                vertexCount += 3;
                totalAreaAfter += triArea;
                continue;
            }

            // Fast path: all 3 vertices inside the box → remove entirely
            var in0 = isInsideBox(s0, box);
            var in1 = isInsideBox(s1, box);
            var in2 = isInsideBox(s2, box);

            if (in0 && in1 && in2) {
                // Collect removed triangle (world-space positions)
                removedTris.push([
                    worldMat.multiplyPoint(p0),
                    worldMat.multiplyPoint(p1),
                    worldMat.multiplyPoint(p2)
                ]);
                continue; // discard from remaining mesh (area NOT added to totalAreaAfter)
            }

            // Build clip-vertex polygon for this triangle
            var triPoly = [
                makeClipVertex(v0, s0),
                makeClipVertex(v1, s1),
                makeClipVertex(v2, s2)
            ];

            // Clip against the box and collect pieces that are OUTSIDE
            var outsideTriangles = clipTriangleOutsideBox(triPoly, box, stride);

            for (var t = 0; t < outsideTriangles.length; t++) {
                appendVertexData(newVertices, outsideTriangles[t][0]);
                appendVertexData(newVertices, outsideTriangles[t][1]);
                appendVertexData(newVertices, outsideTriangles[t][2]);
                newIndices.push(vertexCount, vertexCount + 1, vertexCount + 2);
                vertexCount += 3;

                // Accumulate remaining area from clipped pieces
                var cp0 = new vec3(outsideTriangles[t][0][0], outsideTriangles[t][0][1], outsideTriangles[t][0][2]);
                var cp1 = new vec3(outsideTriangles[t][1][0], outsideTriangles[t][1][1], outsideTriangles[t][1][2]);
                var cp2 = new vec3(outsideTriangles[t][2][0], outsideTriangles[t][2][1], outsideTriangles[t][2][2]);
                totalAreaAfter += cp1.sub(cp0).cross(cp2.sub(cp0)).length * 0.5;
            }
        }

        // Rebuild the mesh with the remaining geometry
        if (newIndices.length > 0) {
            var newMesh = updateMesh(targetMesh, newVertices, newIndices);
            if (newMesh) {
                // Update collider if one exists for this mesh
                if (collider) {
                    updateColliderShape(collider, newMesh);
                }
                meshDataArray[meshIndex].vertexData = newVertices;
                meshDataArray[meshIndex].indices = newIndices;

                print("Trimmed mesh " + meshIndex + ": " +
                      (newIndices.length / 3) + " triangles remaining");
            }
        }
    }

    // Fire callback so the game controller can score the cut
    if (script.api.onTrimComplete && totalAreaBefore > 0) {
        var pct = Math.round((1.0 - totalAreaAfter / totalAreaBefore) * 100);
        pct = Math.max(0, Math.min(pct, 100));  // clamp 0-100
        script.api.onTrimComplete({
            percentRemoved: pct,
            removedTriangles: removedTris
        });
    }
}

// ============================================================
//  BOX CONTAINMENT
// ============================================================

function isInsideBox(screenPos, box) {
    return screenPos.x >= box.minX && screenPos.x <= box.maxX &&
           screenPos.y >= box.minY && screenPos.y <= box.maxY;
}

// ============================================================
//  MESH BUILDING
// ============================================================

function appendVertexData(vertexArray, vData) {
    for (var i = 0; i < vData.length; i++) {
        vertexArray.push(vData[i]);
    }
}

function updateMesh(targetMesh, vertices, indices) {
    var builder = new MeshBuilder([
        { name: "position",  components: 3 },
        { name: "normal",    components: 3, normalized: true },
        { name: "texture0",  components: 2 }
    ]);
    builder.topology  = MeshTopology.Triangles;
    builder.indexType  = MeshIndexType.UInt16;

    builder.appendVerticesInterleaved(vertices);
    builder.appendIndices(indices);

    if (builder.isValid()) {
        var newMesh = builder.getMesh();
        targetMesh.mesh = newMesh;
        builder.updateMesh();
        return newMesh;
    }
    return null;
}

function updateColliderShape(collider, mesh) {
    // createMeshShape() takes no arguments in Lens Studio —
    // create the shape first, then assign the mesh property.
    var meshShape = Shape.createMeshShape();
    meshShape.mesh = mesh;
    collider.shape = meshShape;

    // Toggle enabled state to force the physics engine to pick up
    // the new shape immediately.
    collider.enabled = false;
    collider.enabled = true;

    print("Collider shape updated");
}

// ============================================================
//  TOUCH HANDLING
// ============================================================

script.createEvent("TouchStartEvent").bind(function (eventData) {
    if (!trimEnabled) return;
    startTouchPos = eventData.getTouchPosition();
    isDragging = true;
    if (script.trimOverlay) {
        script.trimOverlay.enabled = true;
    }
    updateBoxIndicator(startTouchPos, startTouchPos);
});

script.createEvent("TouchMoveEvent").bind(function (eventData) {
    if (isDragging) {
        var currentPos = eventData.getTouchPosition();
        updateBoxIndicator(startTouchPos, currentPos);
    }
});

script.createEvent("TouchEndEvent").bind(function (eventData) {
    if (isDragging) {
        performTrim();
        isDragging = false;
        if (script.trimOverlay) {
            script.trimOverlay.enabled = false;
        }
    }
});

// ============================================================
//  VALIDATION
// ============================================================

function validateInputs() {
    if (!script.camera || !script.uvTexture ||
        !script.targetMeshes || script.targetMeshes.length === 0) {
        print("ERROR: Missing required inputs!");
        return false;
    }

    // Warn (but don't block) if collider count doesn't match mesh count.
    // Meshes without a matching collider will simply skip the collider update.
    if (script.useColliders) {
        if (!script.colliders || script.colliders.length === 0) {
            print("WARNING: useColliders is ON but no colliders assigned — collider updates will be skipped.");
        } else if (script.colliders.length < script.targetMeshes.length) {
            print("WARNING: Only " + script.colliders.length + " collider(s) for " +
                  script.targetMeshes.length + " mesh(es). Extra meshes won't update colliders.");
        }
    }
    return true;
}
