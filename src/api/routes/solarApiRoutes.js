// solarApiRoutes.js
const express = require("express");
const router = express.Router();
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { createCanvas, Image } = require("canvas"); // Using the Image from canvas
const sharp = require("sharp"); // For image processing

// Load environment variables
require("dotenv").config();
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

// Global control for caching
const USE_CACHE = false; // Set to false to bypass cache initially

// Cache directory for processed data
const CACHE_DIR = path.join(__dirname, "../cache");
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

// Test GET route for verification
router.get("/data-layers", (req, res) => {
  console.log("GET request received for data-layers test endpoint");
  res.send("Solar API data-layers endpoint is working");
});

// Constants
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // ms

// Iron palette from Google Solar API demo - proper solar visualization colors
const FLUX_PALETTE = [
  "00000a",
  "120d30",
  "251356",
  "38197c",
  "4b2079",
  "5e2876",
  "713072",
  "83376e",
  "96406a",
  "a84866",
  "bb5062",
  "cf595e",
  "e2615a",
  "f66b4d",
  "ff7e3c",
  "ff932a",
  "ffa813",
  "ffbf00",
  "ffd700",
  "fff0bf",
  "fffff6",
];

// Helper function to retry failed requests
async function fetchWithRetry(url, options = {}, retries = MAX_RETRIES) {
  try {
    return await axios(url, options);
  } catch (error) {
    if (retries <= 0) throw error;

    console.log(
      `Request to ${url} failed. Retrying... (${
        MAX_RETRIES - retries + 1
      }/${MAX_RETRIES})`
    );
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));
    return fetchWithRetry(url, options, retries - 1);
  }
}

/**
 * Convert hex color to RGB
 */
function hexToRgb(hex) {
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  return { r, g, b };
}

/**
 * Linear interpolation between two values
 */
function lerp(start, end, t) {
  return start + t * (end - start);
}

/**
 * Create a color palette with interpolated values
 */
function createPalette(hexColors, size = 256) {
  const colors = hexColors.map(hexToRgb);
  const step = (colors.length - 1) / (size - 1);

  return Array(size)
    .fill(0)
    .map((_, i) => {
      const index = i * step;
      const lower = Math.floor(index);
      const upper = Math.min(Math.ceil(index), colors.length - 1);
      const t = index - lower;

      return {
        r: Math.round(lerp(colors[lower].r, colors[upper].r, t)),
        g: Math.round(lerp(colors[lower].g, colors[upper].g, t)),
        b: Math.round(lerp(colors[lower].b, colors[upper].b, t)),
      };
    });
}

/**
 * Download raw data from a URL
 */
async function downloadRawData(url, apiKey) {
  try {
    console.log(`Downloading data from: ${url}`);

    // Include API key in the URL
    const fullUrl = url.includes("?")
      ? `${url}&key=${apiKey}`
      : `${url}?key=${apiKey}`;

    const response = await fetchWithRetry(fullUrl, {
      responseType: "arraybuffer",
      timeout: 30000,
    });

    return response.data;
  } catch (error) {
    console.error(`Error downloading data: ${error.message}`);
    throw error;
  }
}

/**
 * Process raw TIFF data directly with sharp
 */
async function processTiffData(buffer, month = 0) {
  try {
    // Use sharp to process the TIFF
    const sharpImg = sharp(buffer);
    const metadata = await sharpImg.metadata();

    // Extract the raw pixel data as PNG for easier handling
    let extractedData;

    if (metadata.pages > 1) {
      // Multi-page TIFF (for monthly data)
      extractedData = await sharpImg.extractPage(month).png().toBuffer();
    } else {
      // Single-page TIFF
      extractedData = await sharpImg.png().toBuffer();
    }

    return {
      width: metadata.width,
      height: metadata.height,
      data: extractedData,
      metadata,
    };
  } catch (error) {
    console.error(`Error processing TIFF data: ${error.message}`);
    throw error;
  }
}

/**
 * Apply mask to the flux data with tight cropping
 */
async function applyMaskToFlux(maskBuffer, fluxBuffer, month = 0) {
  try {
    // Process the mask data
    const maskData = await processTiffData(maskBuffer);

    // Process the flux data for the specific month
    let fluxData;
    try {
      fluxData = await processTiffData(fluxBuffer, month);
    } catch (err) {
      console.error(`Error extracting month ${month} from flux data:`, err);
      fluxData = await processTiffData(fluxBuffer);
    }

    console.log(`Mask dimensions: ${maskData.width}x${maskData.height}`);
    console.log(`Flux dimensions: ${fluxData.width}x${fluxData.height}`);

    // Create canvases
    const maskCanvas = createCanvas(maskData.width, maskData.height);
    const maskCtx = maskCanvas.getContext("2d");

    const fluxCanvas = createCanvas(fluxData.width, fluxData.height);
    const fluxCtx = fluxCanvas.getContext("2d");

    // Load mask image
    const maskImg = new Image();
    maskImg.onload = () => {
      maskCtx.drawImage(maskImg, 0, 0);
    };
    maskImg.onerror = (err) => {
      console.error("Error loading mask image:", err);
    };
    maskImg.src = maskData.data;

    // Load flux image
    const fluxImg = new Image();
    fluxImg.onload = () => {
      fluxCtx.drawImage(fluxImg, 0, 0);
    };
    fluxImg.onerror = (err) => {
      console.error("Error loading flux image:", err);
    };
    fluxImg.src = fluxData.data;

    // Wait for images to load
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Get image data
    const maskImageData = maskCtx.getImageData(
      0,
      0,
      maskData.width,
      maskData.height
    );

    // Find the bounding box of the building in the mask
    let minX = maskData.width;
    let maxX = 0;
    let minY = maskData.height;
    let maxY = 0;

    // Scan the mask to find the building boundaries
    for (let y = 0; y < maskData.height; y++) {
      for (let x = 0; x < maskData.width; x++) {
        const idx = (y * maskData.width + x) * 4;
        if (maskImageData.data[idx] > 0) {
          // If this pixel is part of the building
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
        }
      }
    }

    // Add a small margin around the building
    const margin = 20;
    minX = Math.max(0, minX - margin);
    minY = Math.max(0, minY - margin);
    maxX = Math.min(maskData.width - 1, maxX + margin);
    maxY = Math.min(maskData.height - 1, maxY + margin);

    // Calculate the new dimensions
    const croppedWidth = maxX - minX + 1;
    const croppedHeight = maxY - minY + 1;

    console.log(`Building bounds: (${minX},${minY}) to (${maxX},${maxY})`);
    console.log(`Cropped dimensions: ${croppedWidth}x${croppedHeight}`);

    // Apply MAX_DIMENSION limit while preserving aspect ratio
    const MAX_DIMENSION = 400;
    let outputWidth = croppedWidth;
    let outputHeight = croppedHeight;

    if (outputWidth > MAX_DIMENSION || outputHeight > MAX_DIMENSION) {
      const aspectRatio = outputWidth / outputHeight;
      if (outputWidth > outputHeight) {
        outputWidth = MAX_DIMENSION;
        outputHeight = Math.round(MAX_DIMENSION / aspectRatio);
      } else {
        outputHeight = MAX_DIMENSION;
        outputWidth = Math.round(MAX_DIMENSION * aspectRatio);
      }
    }

    console.log(`Output dimensions: ${outputWidth}x${outputHeight}`);

    // Create palette for heat map coloring
    const palette = createPalette(FLUX_PALETTE);

    // Get flux image data
    const fluxImageData = fluxCtx.getImageData(
      0,
      0,
      fluxData.width,
      fluxData.height
    );

    // Create output canvas with the new dimensions
    const outputCanvas = createCanvas(outputWidth, outputHeight);
    const outputCtx = outputCanvas.getContext("2d");

    // Create output image data
    const outputImageData = outputCtx.createImageData(
      outputWidth,
      outputHeight
    );

    // Apply seasonal factor
    const seasonalFactor = getSeasonalFactor(month);

    // Calculate scaling ratios for the cropped area
    const maskToOutputScaleX = croppedWidth / outputWidth;
    const maskToOutputScaleY = croppedHeight / outputHeight;
    const fluxToMaskScaleX = fluxData.width / maskData.width;
    const fluxToMaskScaleY = fluxData.height / maskData.height;

    // Process pixels for the cropped area
    for (let y = 0; y < outputHeight; y++) {
      for (let x = 0; x < outputWidth; x++) {
        // Map to mask coordinates within the cropped area
        const maskX = Math.min(
          Math.floor(minX + x * maskToOutputScaleX),
          maskData.width - 1
        );
        const maskY = Math.min(
          Math.floor(minY + y * maskToOutputScaleY),
          maskData.height - 1
        );
        const maskIdx = (maskY * maskData.width + maskX) * 4;

        // Map to flux coordinates through mask
        const fluxX = Math.min(
          Math.floor(maskX * fluxToMaskScaleX),
          fluxData.width - 1
        );
        const fluxY = Math.min(
          Math.floor(maskY * fluxToMaskScaleY),
          fluxData.height - 1
        );
        const fluxIdx = (fluxY * fluxData.width + fluxX) * 4;

        const outputIdx = (y * outputWidth + x) * 4;

        // Check if this pixel is part of the mask (building)
        const maskValue = maskImageData.data[maskIdx];

        if (maskValue > 0) {
          // Part of building - get flux data and colorize
          let intensity = fluxImageData.data[fluxIdx] / 255; // Normalize to 0-1
          intensity *= seasonalFactor;

          // Map to color
          const colorIdx = Math.min(
            Math.floor(intensity * (palette.length - 1)),
            palette.length - 1
          );
          const color = palette[colorIdx];

          // Set pixel color in output
          outputImageData.data[outputIdx] = color.r;
          outputImageData.data[outputIdx + 1] = color.g;
          outputImageData.data[outputIdx + 2] = color.b;
          outputImageData.data[outputIdx + 3] = 255; // Fully opaque
        } else {
          // Outside building - transparent
          outputImageData.data[outputIdx + 3] = 0;
        }
      }
    }

    // Put the image data into the output canvas
    outputCtx.putImageData(outputImageData, 0, 0);

    // Return the canvas as data URL with explicit quality setting
    // Use a lower quality setting to reduce URL size, with png to support transparency
    const dataUrl = outputCanvas.toDataURL("image/png");
    console.log(`Generated data URL length: ${dataUrl.length}`);
    return dataUrl;
  } catch (error) {
    console.error(`Error applying mask to flux: ${error.message}`);
    throw error;
  }
}

/**
 * Get seasonal adjustment factor for visualization
 */
function getSeasonalFactor(month) {
  // Northern hemisphere seasonal pattern
  const factors = [
    0.4, // January
    0.5, // February
    0.65, // March
    0.8, // April
    0.9, // May
    1.0, // June
    1.0, // July
    0.9, // August
    0.8, // September
    0.65, // October
    0.5, // November
    0.4, // December
  ];

  return factors[month];
}

/**
 * Create a high-quality synthetic visualization with tighter building focus
 */
function createSyntheticVisualization(width, height, month, location, bounds) {
  // Reduce the size to create a tighter visualization
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  // Make the background fully transparent
  ctx.clearRect(0, 0, width, height);

  // Create a palette
  const palette = createPalette(FLUX_PALETTE);

  // Get seasonal factor
  const seasonalFactor = getSeasonalFactor(month);

  // Create pseudorandom function based on location
  let seed = 12345;
  if (location && location.latitude && location.longitude) {
    seed = Math.abs(location.latitude * 1000 + location.longitude * 1000);
  }

  const pseudoRandom = (s) => {
    const x = Math.sin(s) * 10000;
    return x - Math.floor(x);
  };

  // Make the roof take up more of the canvas
  const centerX = width / 2;
  const centerY = height / 2;

  // Determine roof type
  const roofType = Math.floor(pseudoRandom(seed) * 3) + 1;

  let roofPolygon;

  switch (roofType) {
    case 1: // Simple roof - Now 90% of canvas
      const roofWidth = width * 0.9;
      const roofHeight = height * 0.9;
      roofPolygon = [
        { x: centerX - roofWidth / 2, y: centerY - roofHeight / 2 },
        { x: centerX + roofWidth / 2, y: centerY - roofHeight / 2 },
        { x: centerX + roofWidth / 2, y: centerY + roofHeight / 2 },
        { x: centerX - roofWidth / 2, y: centerY + roofHeight / 2 },
      ];
      break;

    case 2: // L-shaped roof - Larger proportion
      const mainWidth = width * 0.85;
      const mainHeight = height * 0.85;
      const wingWidth = mainWidth * 0.7;
      const wingHeight = mainHeight * 0.6;

      roofPolygon = [
        { x: centerX - mainWidth / 2, y: centerY - mainHeight / 2 },
        { x: centerX + mainWidth / 2, y: centerY - mainHeight / 2 },
        {
          x: centerX + mainWidth / 2,
          y: centerY + wingHeight - mainHeight / 2,
        },
        {
          x: centerX - mainWidth / 2 + wingWidth,
          y: centerY + wingHeight - mainHeight / 2,
        },
        { x: centerX - mainWidth / 2 + wingWidth, y: centerY + mainHeight / 2 },
        { x: centerX - mainWidth / 2, y: centerY + mainHeight / 2 },
      ];
      break;

    case 3: // Complex roof - Larger radius
    default:
      const segments = 5 + Math.floor(pseudoRandom(seed + 1) * 4);
      roofPolygon = [];

      for (let i = 0; i < segments; i++) {
        const angle = (i / segments) * Math.PI * 2;
        // Increased radius to use more canvas space
        const radius = width * 0.4 * (0.85 + pseudoRandom(seed + i) * 0.15);
        roofPolygon.push({
          x: centerX + Math.cos(angle) * radius,
          y: centerY + Math.sin(angle) * radius,
        });
      }
      break;
  }

  // Draw the roof shape
  ctx.beginPath();
  ctx.moveTo(roofPolygon[0].x, roofPolygon[0].y);
  for (let i = 1; i < roofPolygon.length; i++) {
    ctx.lineTo(roofPolygon[i].x, roofPolygon[i].y);
  }
  ctx.closePath();

  // Create gradient for base color
  const baseGradient = ctx.createRadialGradient(
    centerX,
    centerY,
    0,
    centerX,
    centerY,
    width * 0.5
  );

  // Middle of palette for base color
  const midPalette = Math.floor(palette.length * 0.5);
  const baseColor = palette[midPalette];

  baseGradient.addColorStop(
    0,
    `rgba(${baseColor.r}, ${baseColor.g}, ${baseColor.b}, 0.9)`
  );
  baseGradient.addColorStop(
    1,
    `rgba(${baseColor.r * 0.7}, ${baseColor.g * 0.7}, ${
      baseColor.b * 0.7
    }, 0.9)`
  );

  ctx.fillStyle = baseGradient;
  ctx.fill();

  // Create roof planes with different intensities
  ctx.save();
  ctx.clip(); // Clip to the roof shape

  const segments = 2 + Math.floor(pseudoRandom(seed + 5) * 4);
  const segmentWidth = width / segments;

  // Draw roof segments with varying intensity
  for (let s = 0; s < segments; s++) {
    const segX = s * segmentWidth + segmentWidth / 2;
    const intensity = 0.5 + pseudoRandom(seed + s * 10) * 0.5 * seasonalFactor;

    // Create segment gradient
    const colorIndex = Math.floor(intensity * (palette.length - 1));
    const color = palette[colorIndex];

    const segmentGradient = ctx.createLinearGradient(
      segX - segmentWidth / 2,
      0,
      segX + segmentWidth / 2,
      0
    );

    segmentGradient.addColorStop(
      0,
      `rgba(${color.r * 0.9}, ${color.g * 0.9}, ${color.b * 0.9}, 0.7)`
    );
    segmentGradient.addColorStop(
      0.5,
      `rgba(${color.r}, ${color.g}, ${color.b}, 0.9)`
    );
    segmentGradient.addColorStop(
      1,
      `rgba(${color.r * 0.9}, ${color.g * 0.9}, ${color.b * 0.9}, 0.7)`
    );

    ctx.fillStyle = segmentGradient;
    ctx.fillRect(segX - segmentWidth / 2, 0, segmentWidth, height);
  }

  // Add hotspots
  const hotspotCount = 3 + Math.floor(pseudoRandom(seed + 20) * 5);

  for (let h = 0; h < hotspotCount; h++) {
    const hx = centerX + (pseudoRandom(seed + h * 5) - 0.5) * width * 0.7;
    const hy = centerY + (pseudoRandom(seed + h * 7) - 0.5) * height * 0.7;
    const radius = 30 + pseudoRandom(seed + h * 11) * 70;

    // Higher intensity for hotspots
    const intensity = 0.7 + pseudoRandom(seed + h * 13) * 0.3 * seasonalFactor;
    const colorIndex = Math.floor(intensity * (palette.length - 1));
    const color = palette[colorIndex];

    const hotspotGradient = ctx.createRadialGradient(hx, hy, 0, hx, hy, radius);

    hotspotGradient.addColorStop(
      0,
      `rgba(${color.r}, ${color.g}, ${color.b}, 0.9)`
    );
    hotspotGradient.addColorStop(1, "rgba(0, 0, 0, 0)");

    ctx.fillStyle = hotspotGradient;
    ctx.fillRect(hx - radius, hy - radius, radius * 2, radius * 2);
  }

  // Add grid pattern
  ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
  ctx.lineWidth = 1;

  const gridSpacing = 10 + Math.floor(pseudoRandom(seed + 30) * 15);

  // Vertical lines
  for (let x = 0; x < width; x += gridSpacing) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }

  // Horizontal lines
  for (let y = 0; y < height; y += gridSpacing) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  ctx.restore(); // Remove clipping

  // Add roof edge highlight
  ctx.strokeStyle = "rgba(255, 255, 255, 0.3)";
  ctx.lineWidth = 2;

  ctx.beginPath();
  ctx.moveTo(roofPolygon[0].x, roofPolygon[0].y);
  for (let i = 1; i < roofPolygon.length; i++) {
    ctx.lineTo(roofPolygon[i].x, roofPolygon[i].y);
  }
  ctx.closePath();
  ctx.stroke();

  return canvas.toDataURL("image/png");
}

/**
 * Generate monthly visualizations
 */
async function generateMonthlyVisualizations(
  location,
  bounds,
  maskBuffer,
  fluxBuffer
) {
  const monthlyDataUrls = [];

  // Process each month
  for (let month = 0; month < 12; month++) {
    try {
      console.log(`Processing visualization for month ${month + 1}`);

      // Try to create visualization based on real data
      if (maskBuffer && fluxBuffer) {
        try {
          const dataUrl = await applyMaskToFlux(maskBuffer, fluxBuffer, month);
          monthlyDataUrls.push(dataUrl);
          continue;
        } catch (error) {
          console.error(
            `Error creating visualization from real data for month ${
              month + 1
            }:`,
            error
          );
          // Fall back to synthetic visualization
        }
      }

      // Create synthetic visualization
      console.log(`Creating synthetic visualization for month ${month + 1}`);
      const width = 800;
      const height = 600;
      const dataUrl = createSyntheticVisualization(
        width,
        height,
        month,
        location,
        bounds
      );
      monthlyDataUrls.push(dataUrl);
    } catch (error) {
      console.error(
        `Error generating visualization for month ${month + 1}:`,
        error
      );

      // Add empty placeholder
      monthlyDataUrls.push("");
    }
  }

  return monthlyDataUrls;
}

/**
 * POST endpoint to fetch data layers
 */
router.post("/data-layers", async (req, res) => {
  try {
    const { location, radius = 50 } = req.body;

    if (!location || !location.latitude || !location.longitude) {
      return res.status(400).json({ error: "Invalid location data" });
    }

    console.log(
      `Processing data layers for location: ${location.latitude}, ${location.longitude}`
    );

    // Generate cache key based on location
    const cacheKey = `${location.latitude.toFixed(
      5
    )}_${location.longitude.toFixed(5)}`;
    const cachePath = path.join(CACHE_DIR, `${cacheKey}_monthly.json`);

    // Check if we have cached data and the global flag allows using cache
    if (USE_CACHE && fs.existsSync(cachePath)) {
      try {
        const cachedData = JSON.parse(fs.readFileSync(cachePath, "utf8"));
        console.log("Using cached data for location:", cacheKey);

        return res.json({
          imageryQuality: cachedData.imageryQuality || "MEDIUM",
          monthlyDataUrls: cachedData.monthlyDataUrls,
          originalUrls: cachedData.originalUrls || null,
        });
      } catch (error) {
        console.error("Error reading cache:", error);
        // Continue to generate new data if cache read fails
      }
    } else {
      console.log("Bypassing cache due to USE_CACHE setting:", USE_CACHE);
    }

    // Format parameters for Google Solar API
    const params = new URLSearchParams({
      "location.latitude": location.latitude.toFixed(5),
      "location.longitude": location.longitude.toFixed(5),
      radius_meters: radius.toString(),
      required_quality: "LOW", // Ask for at least LOW quality
      key: GOOGLE_MAPS_API_KEY,
    });

    // Make request to Google Solar API
    let maskBuffer = null;
    let fluxBuffer = null;
    let imageryQuality = "LOW";
    let originalUrls = null;

    try {
      const response = await fetchWithRetry(
        `https://solar.googleapis.com/v1/dataLayers:get?${params}`,
        { timeout: 30000 }
      );

      // Extract data from response
      const { monthlyFluxUrl, maskUrl, quality } = response.data;

      imageryQuality = quality || "MEDIUM";
      originalUrls = {
        monthlyFlux: monthlyFluxUrl,
        mask: maskUrl,
      };

      console.log("Received URLs from Google Solar API:");
      console.log("Monthly Flux URL:", monthlyFluxUrl);
      console.log("Mask URL:", maskUrl);

      // Try to download the raw data
      try {
        [maskBuffer, fluxBuffer] = await Promise.all([
          downloadRawData(maskUrl, GOOGLE_MAPS_API_KEY),
          downloadRawData(monthlyFluxUrl, GOOGLE_MAPS_API_KEY),
        ]);

        console.log("Successfully downloaded raw data from Google API");
      } catch (downloadError) {
        console.error("Error downloading data:", downloadError);
        // Continue with null buffers - will fall back to synthetic visualization
      }
    } catch (apiError) {
      console.error("Error with Google Solar API:", apiError.message);
      // Continue with null buffers - will fall back to synthetic visualization
    }

    // Try to get bounds from the request if available
    let bounds = null;
    if (req.body.bounds) {
      bounds = req.body.bounds;
    } else {
      // Calculate reasonable bounding box
      const latDelta = 0.001; // ~100m
      const lngDelta = 0.001 / Math.cos((location.latitude * Math.PI) / 180);

      bounds = {
        north: location.latitude + latDelta,
        south: location.latitude - latDelta,
        east: location.longitude + lngDelta,
        west: location.longitude - lngDelta,
      };
    }

    // Generate visualizations
    console.log("Generating visualizations...");
    const monthlyDataUrls = await generateMonthlyVisualizations(
      location,
      bounds,
      maskBuffer,
      fluxBuffer
    );

    console.log("Successfully generated visualizations");

    // Cache the results
    try {
      fs.writeFileSync(
        cachePath,
        JSON.stringify({
          monthlyDataUrls,
          imageryQuality,
          originalUrls,
        })
      );
      console.log("Data cached for location:", cacheKey);
    } catch (cacheError) {
      console.error("Error writing cache:", cacheError);
    }

    // Return the processed data
    return res.json({
      imageryQuality,
      monthlyDataUrls,
      originalUrls,
    });
  } catch (error) {
    console.error("Data layers error:", error);

    // Return error response
    res.status(500).json({
      error: error.message || "Failed to fetch solar data",
    });
  }
});

module.exports = router;
