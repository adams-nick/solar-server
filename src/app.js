const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const app = express();

//We need to increase the size can be included in requests/responses to support recieving aerial image from client, and recieving polygons from ML
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// Middleware
app.use(helmet());
app.use(
  cors({
    origin: ["http://localhost:5173", "http://localhost:3000"], // Add your frontend URLs
    credentials: true,
  })
);
app.use(express.json());

// Simple test route
app.get("/", (req, res) => {
  res.json({ message: "Welcome to SolarScanner API" });
});

// Include routes
const internalRoutes = require("./api/routes/internalRoutes");
app.use("/api/v1/internal", internalRoutes);

//NEW
// places routes for automcomplete address
const placesRoutes = require("./api/routes/placesRoutes");
app.use("/api/v1/places", placesRoutes);
// Microsoft building footprints route for map overlay ot confirm selection
const buildingRoutes = require("./api/routes/buildingRoutes");
app.use("/api/v1/buildings", buildingRoutes);
// Solar API request after building was selected & confirmed on front-end
const solarRoutes = require("./api/routes/solarRoutes");
app.use("/api/v1/solar", solarRoutes);
// solar APi route for solar flux layer, WIP
const dataLayersRoutes = require("./api/routes/dataLayersRoutes");
app.use("/api/v1/data-layers", dataLayersRoutes);
//For ML SERVER:
const roofSegmentRoutes = require("./api/routes/roofSegmentRoutes");
app.use("/api/v1/roof", roofSegmentRoutes);

//For Comprehensive:
const comprehensiveRoute = require("./api/routes/comprehensiveRoute");
app.use("/api/v1/solar", comprehensiveRoute);

// For training endpoint:
const trainingRoutes = require("./api/routes/trainingRoutes");
app.use("/api/v1/training", trainingRoutes);

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    message: "Something went wrong!",
  });
});

module.exports = app;
