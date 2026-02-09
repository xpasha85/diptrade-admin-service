import { Router } from 'express';
import multer from 'multer';
import {
  readCars,
  readCarById,
  createCar,
  updateCar,
  deleteCar,
  bulkDeleteCars,
  uploadCarPhotos,
  deleteCarPhoto,
  reorderCarPhotos
} from '../services/carsStore.js';
import { loadEnv } from '../config/env.js';

const router = Router();
const env = loadEnv();

function handleErr(res, e) {
  res.status(e.status || 500).json({
    error: e.code || 'UNKNOWN_ERROR',
    message: e.message || 'Unknown error'
  });
}

// Multer: храним в памяти, дальше sharp -> webp -> диск
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 15 * 1024 * 1024, // 15MB на файл
    files: 20
  }
});

router.get('/', async (req, res) => {
  try {
    const cars = await readCars(env);
    res.json({ cars });
  } catch (e) {
    handleErr(res, e);
  }
});

router.get('/:id', async (req, res) => {
  try {
    const car = await readCarById(env, req.params.id);
    if (!car) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Car not found' });
    }
    res.json({ car });
  } catch (e) {
    handleErr(res, e);
  }
});

// Stage D: create
router.post('/', async (req, res) => {
  try {
    const car = await createCar(env, req.body || {});
    res.status(201).json({ car });
  } catch (e) {
    handleErr(res, e);
  }
});

// Stage D: update
router.patch('/:id', async (req, res) => {
  try {
    const car = await updateCar(env, req.params.id, req.body || {});
    res.json({ car });
  } catch (e) {
    handleErr(res, e);
  }
});

// Stage D: delete
router.delete('/:id', async (req, res) => {
  try {
    const result = await deleteCar(env, req.params.id);
    res.json(result);
  } catch (e) {
    handleErr(res, e);
  }
});

// Stage D: bulk delete
router.post('/bulk-delete', async (req, res) => {
  try {
    const ids = req.body?.ids;
    const result = await bulkDeleteCars(env, ids);
    res.json(result);
  } catch (e) {
    handleErr(res, e);
  }
});

/* ===========================
   Stage E: Photos
   =========================== */

// Upload photos (multipart/form-data, field name: "files")
router.post('/:id/photos', upload.array('files', 20), async (req, res) => {
  try {
    const files = req.files || [];
    const car = await uploadCarPhotos(env, req.params.id, files);
    res.status(201).json({ car });
  } catch (e) {
    handleErr(res, e);
  }
});

// Reorder photos
router.patch('/:id/photos/reorder', async (req, res) => {
  try {
    const photos = req.body?.photos;
    const car = await reorderCarPhotos(env, req.params.id, photos);
    res.json({ car });
  } catch (e) {
    handleErr(res, e);
  }
});

// Delete one photo by file name
router.delete('/:id/photos/:name', async (req, res) => {
  try {
    const car = await deleteCarPhoto(env, req.params.id, req.params.name);
    res.json({ car });
  } catch (e) {
    handleErr(res, e);
  }
});

export default router;
