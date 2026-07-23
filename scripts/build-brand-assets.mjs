import sharp from "sharp";

const source = "public/brand/primary-logo.png";

await Promise.all([
  sharp(source).resize(192, 192, { fit: "contain" }).png().toFile("public/icon-192.png"),
  sharp(source).resize(512, 512, { fit: "contain" }).png().toFile("public/icon-512.png"),
  sharp(source).resize(180, 180, { fit: "contain" }).png().toFile("public/apple-touch-icon.png"),
]);

console.log("TIP app icons regenerated from the approved primary logo.");
