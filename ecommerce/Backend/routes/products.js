// routes/products.js
const express = require('express');
const router = express.Router();
const { checkJwt, checkRole } = require('../middleware/auth');

// Récupérer tous les produits (public)
router.get('/', async (req, res) => {
  try {
    const { category, featured, search, page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;
    
    let query = `
      SELECT p.*, c.name as category_name,
      (SELECT image_url FROM product_images WHERE product_id = p.id AND is_primary = 1 LIMIT 1) as primary_image
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE p.is_active = 1
    `;
    
    const queryParams = [];
    
    // Filtrer par catégorie
    if (category) {
      query += ` AND p.category_id = ?`;
      queryParams.push(category);
    }
    
    // Filtrer par produits mis en avant
    if (featured === 'true') {
      query += ` AND p.is_featured = 1`;
    }
    
    // Recherche par nom
    if (search) {
      query += ` AND (p.name LIKE ? OR p.description LIKE ?)`;
      queryParams.push(`%${search}%`, `%${search}%`);
    }
    
    // Ajouter pagination
    query += ` ORDER BY p.created_at DESC LIMIT ? OFFSET ?`;
    queryParams.push(Number(limit), Number(offset));
    
    const [products] = await req.db.execute(query, queryParams);
    
    // Compter le nombre total de produits pour la pagination
    const [countResult] = await req.db.execute(
      `SELECT COUNT(*) as total FROM products p WHERE p.is_active = 1`,
      []
    );
    
    const total = countResult[0].total;
    
    res.json({
      products,
      pagination: {
        total,
        page: Number(page),
        limit: Number(limit),
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Erreur lors de la récupération des produits:', error);
    res.status(500).json({ message: 'Erreur lors de la récupération des produits' });
  }
});

// Récupérer un produit par son slug
router.get('/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    
    // Récupérer les détails du produit
    const [products] = await req.db.execute(
      `SELECT * FROM products WHERE slug = ? AND is_active = 1`,
      [slug]
    );
    
    if (products.length === 0) {
      return res.status(404).json({ message: 'Produit non trouvé' });
    }
    
    const product = products[0];
    
    // Récupérer les images du produit
    const [images] = await req.db.execute(
      `SELECT * FROM product_images WHERE product_id = ?`,
      [product.id]
    );
    
    // Récupérer les variantes du produit
    const [variants] = await req.db.execute(
      `SELECT pv.*, 
       (SELECT GROUP_CONCAT(av.id, ':', a.type, ':', av.value) 
        FROM variant_attribute_values vav
        JOIN attribute_values av ON vav.attribute_value_id = av.id
        JOIN attributes a ON av.attribute_id = a.id
        WHERE vav.variant_id = pv.id) as attributes
       FROM product_variants pv
       WHERE pv.product_id = ?`,
      [product.id]
    );
    
    // Transformer les attributs de chaîne en objet
    const processedVariants = variants.map(variant => {
      let attributesObj = {};
      if (variant.attributes) {
        const attrArray = variant.attributes.split(',');
        attrArray.forEach(attr => {
          const [id, type, value] = attr.split(':');
          if (!attributesObj[type]) {
            attributesObj[type] = [];
          }
          attributesObj[type].push({
            id: Number(id),
            value
          });
        });
      }
      return {
        ...variant,
        attributes: attributesObj
      };
    });
    
    res.json({
      ...product,
      images,
      variants: processedVariants
    });
  } catch (error) {
    console.error('Erreur lors de la récupération du produit:', error);
    res.status(500).json({ message: 'Erreur lors de la récupération du produit' });
  }
});

// Ajouter un produit (admin seulement)
router.post('/', checkJwt, checkRole('admin'), async (req, res) => {
  try {
    const {
      name,
      slug,
      description,
      price,
      discount_price,
      category_id,
      stock,
      is_featured,
      is_active,
      images,
      variants
    } = req.body;
    
    // Commencer une transaction
    const connection = await req.db.getConnection();
    await connection.beginTransaction();
    
    try {
      // Insérer le produit
      const [result] = await connection.execute(
        `INSERT INTO products (name, slug, description, price, discount_price, category_id, stock, is_featured, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [name, slug, description, price, discount_price, category_id, stock, is_featured, is_active]
      );
      
      const productId = result.insertId;
      
      // Insérer les images
      if (images && images.length > 0) {
        for (const image of images) {
          await connection.execute(
            `INSERT INTO product_images (product_id, image_url, is_primary)
             VALUES (?, ?, ?)`,
            [productId, image.url, image.is_primary || false]
          );
        }
      }
      
      // Insérer les variantes
      if (variants && variants.length > 0) {
        for (const variant of variants) {
          const [variantResult] = await connection.execute(
            `INSERT INTO product_variants (product_id, sku, stock, price_adjustment)
             VALUES (?, ?, ?, ?)`,
            [productId, variant.sku, variant.stock, variant.price_adjustment || 0]
          );
          
          const variantId = variantResult.insertId;
          
          // Insérer les attributs des variantes
          if (variant.attributes && variant.attributes.length > 0) {
            for (const attrValueId of variant.attributes) {
              await connection.execute(
                `INSERT INTO variant_attribute_values (variant_id, attribute_value_id)
                 VALUES (?, ?)`,
                [variantId, attrValueId]
              );
            }
          }
        }
      }
      
      // Valider la transaction
      await connection.commit();
      
      res.status(201).json({
        message: 'Produit ajouté avec succès',
        productId
      });
    } catch (error) {
      // Annuler la transaction en cas d'erreur
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('Erreur lors de l\'ajout du produit:', error);
    res.status(500).json({ message: 'Erreur lors de l\'ajout du produit' });
  }
});

// Mettre à jour un produit (admin seulement)
router.put('/:id', checkJwt, checkRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name,
      slug,
      description,
      price,
      discount_price,
      category_id,
      stock,
      is_featured,
      is_active
    } = req.body;
    
    const [result] = await req.db.execute(
      `UPDATE products
       SET name = ?, slug = ?, description = ?, price = ?, discount_price = ?,
           category_id = ?, stock = ?, is_featured = ?, is_active = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [name, slug, description, price, discount_price, category_id, 
       stock, is_featured, is_active, id]
    );
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Produit non trouvé' });
    }
    
    res.json({ message: 'Produit mis à jour avec succès' });
  } catch (error) {
    console.error('Erreur lors de la mise à jour du produit:', error);
    res.status(500).json({ message: 'Erreur lors de la mise à jour du produit' });
  }
});

// Supprimer un produit (admin seulement)
router.delete('/:id', checkJwt, checkRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    
    const [result] = await req.db.execute(
      `DELETE FROM products WHERE id = ?`,
      [id]
    );
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Produit non trouvé' });
    }
    
    res.json({ message: 'Produit supprimé avec succès' });
  } catch (error) {
    console.error('Erreur lors de la suppression du produit:', error);
    res.status(500).json({ message: 'Erreur lors de la suppression du produit' });
  }
});

module.exports = router;