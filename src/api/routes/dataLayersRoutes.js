// src/api/routes/dataLayersRoutes.js
const express = require("express");
const router = express.Router();
const dataLayersController = require("../controllers/dataLayersController");

// Test GET route for verification
router.get("/", dataLayersController.testEndpoint);

// POST endpoint to fetch data layers
router.post("/", dataLayersController.processDataLayer);

module.exports = router;
