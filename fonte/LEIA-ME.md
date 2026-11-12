# Mielina by Quíron — fonte

Dados: pacote npm @authorod/svitylo-3d-anatomy-data@1.2.0 (Z-Anatomy, CC BY-SA 4.0; BodyParts3D CC BY 4.0; córtex do Brain for Blender).
Passos: npm i three@0.170.0 @gltf-transform/core@4 @gltf-transform/extensions@4 meshoptimizer esbuild @fontsource/unbounded @fontsource/figtree @fontsource/martian-mono
1. node extract.mjs standard nervous raw/nervous ; node extract.mjs economy skeletal,regions raw/context
2. python3 structures.py (categorias, cores, nomes em pt.py, fichas em fichas.py)
3. node build-data.mjs (quantiza + meshopt + gzip)
4. python3 assemble.py (gera mielina.html autônomo e a versão do Artifact)
Caminhos fixos em /tmp/w/ nos scripts.
