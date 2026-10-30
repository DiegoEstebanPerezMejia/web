BEGIN;
INSERT INTO usuario(nombre,nombre_usuario,correo,hash_contrasena)
SELECT 'Empleado de demostración','demo','demo@example.com','SIN_ACCESO_LOGIN' WHERE NOT EXISTS(SELECT 1 FROM usuario WHERE nombre_usuario='demo');
INSERT INTO categoria(nombre) VALUES('Playeras'),('Camisas'),('Pantalones'),('Sudaderas') ON CONFLICT DO NOTHING;
INSERT INTO cliente(nombre,telefono,correo) SELECT 'Daniel Ejemplo','5500000001','daniel@example.com' WHERE NOT EXISTS(SELECT 1 FROM cliente WHERE correo='daniel@example.com');
INSERT INTO proveedor(nombre,telefono,correo) SELECT 'Textiles Norte (ficticio)','5500000002','norte@example.com' WHERE NOT EXISTS(SELECT 1 FROM proveedor WHERE correo='norte@example.com');
INSERT INTO producto(id_categoria,nombre,marca,descripcion,precio_venta)
SELECT c.id_categoria,d.nombre,'Urbano Demo','Ropa casual de hombre — datos ficticios',d.precio
FROM (VALUES ('Playeras','Playera básica',249.00),('Camisas','Camisa Oxford',599.00),('Pantalones','Pantalón chino',749.00),('Sudaderas','Sudadera clásica',699.00)) AS d(categoria,nombre,precio)
JOIN categoria c ON c.nombre=d.categoria WHERE NOT EXISTS(SELECT 1 FROM producto p WHERE p.nombre=d.nombre);
INSERT INTO catalogo(id_producto) SELECT id_producto FROM producto ON CONFLICT DO NOTHING;
INSERT INTO variante_producto(id_producto,talla,color)
SELECT p.id_producto,t.talla,c.color FROM producto p CROSS JOIN (VALUES('M'),('L')) t(talla) CROSS JOIN (VALUES('Negro'),('Azul marino')) c(color) ON CONFLICT DO NOTHING;
INSERT INTO inventario(id_variante,existencia,stock_minimo,stock_maximo) SELECT id_variante,12,3,50 FROM variante_producto ON CONFLICT DO NOTHING;
INSERT INTO proveedor_producto(id_proveedor,id_producto) SELECT pr.id_proveedor,p.id_producto FROM proveedor pr CROSS JOIN producto p WHERE pr.correo='norte@example.com' ON CONFLICT DO NOTHING;
COMMIT;
