const fs = require('fs');
const faceapi = require('face-api.js');
const canvas = require('canvas');

const { Canvas, Image, loadImage, ImageData  } = canvas; // Import canvas
const { FaceAuth } = require('./../../models/global/FaceAuth');
const path = require('path');
faceapi.env.monkeyPatch({ Canvas, Image, ImageData });

// Load FaceAPI models (ensure this runs before face detection)
const MODEL_URL = path.join(__dirname, './../../models/global/facemodels/');

async function loadModels() {
    await faceapi.nets.ssdMobilenetv1.loadFromDisk(MODEL_URL);
    await faceapi.nets.faceLandmark68Net.loadFromDisk(MODEL_URL);
    await faceapi.nets.faceRecognitionNet.loadFromDisk(MODEL_URL);
}
loadModels();

async function processFace(imageBuffer) {
    try {
        // Convert image buffer to an Image object
        const img = await canvas.loadImage(imageBuffer);
        
        // Create a canvas from the image
        const inputCanvas = canvas.createCanvas(img.width, img.height);
        const ctx = inputCanvas.getContext('2d');
        ctx.drawImage(img, 0, 0);

        // Detect face and extract descriptors
        const detections = await faceapi.detectSingleFace(inputCanvas).withFaceLandmarks().withFaceDescriptor();

        if (!detections) {
            throw new Error("No face detected.");
        }

        return detections.descriptor; // Return face embeddings
    } catch (error) {
        console.error("Face Processing Error:", error);
        throw new Error("Face recognition failed.");
    }
}

exports.registerFace = async (req, res) => {
    try {
        console.log("Incoming Face Registration Request:", req.body, req.file);

        if (!req.file) {
            return res.status(400).json({ error: "No image uploaded." });
        }

        const imageBuffer = fs.readFileSync(req.file.path);
        console.log("Image Buffer Loaded Successfully");

        const faceData = await processFace(imageBuffer);
        console.log(typeof faceData, Array.isArray(faceData));
        console.log("Face Data Processed Successfully:", faceData);

        await FaceAuth.create({ email: req.body.email, faceData: Array.from(faceData) });
        console.log("Face Data Stored in Database");

        res.status(200).json({ message: "Face registered successfully!" });
    } catch (error) {
        console.error("Face Registration Error:", error);
        res.status(500).json({ error: `Face registration failed: ${error.message}` });
    }
};

exports.verifyFace = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: "No image uploaded." });
        }

        const imageBuffer = fs.readFileSync(req.file.path);
        const uploadedFace = await processFace(imageBuffer);

        const allUsers = await FaceAuth.find({});
        const knownFaceDescriptors = allUsers.map(user => ({
            descriptor: new Float32Array(user.faceData || []),
            email: user.email
        }));

        if (knownFaceDescriptors.length === 0) {
            return res.status(404).json({ error: "No registered faces found." });
        }

        const faceMatcher = new faceapi.FaceMatcher(knownFaceDescriptors.map(u => u.descriptor));
        const bestMatch = faceMatcher.findBestMatch(uploadedFace);

        if (bestMatch.distance < 0.6) {
            const matchedUser = knownFaceDescriptors[bestMatch.label];
            return res.status(200).json({ message: "Authentication successful!", email: matchedUser.email });
        } else {
            return res.status(401).json({ error: "Face not recognized." });
        }
    } catch (error) {
        res.status(500).json({ error: `Face authentication failed: ${error.message}` });
    }
};
