const express = require('express');
const productController = require('../controllers/productController');

const router = express.Router();

router.post('/', productController.create);
router.get('/', productController.list);
router.get('/:pid', productController.get);
router.put('/:pid', productController.update);
router.delete('/:pid', productController.remove);

module.exports = router;
