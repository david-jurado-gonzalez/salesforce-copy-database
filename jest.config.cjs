// jest.config.cjs
module.exports = {
  testEnvironment: 'node',
extensionsToTreatAsEsm: ['.ts', '.tsx', '.mts'],
  transform: {
    '^.+\\.m?[tj]sx?$': ['ts-jest', { useESM: true }],
  },
  transformIgnorePatterns: [
    '/node_modules/(?!chalk)/' // Solo transforma 'chalk' si es necesario, ignora el resto de node_modules
  ],
  modulePathIgnorePatterns: ['<rootDir>/.localdevserver'],
  // Si tus archivos fuente están en 'src' y las pruebas en 'test'
  roots: ['<rootDir>/src', '<rootDir>/test'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node', 'mjs'],
  moduleNameMapper: {
    // Handle .js extensions in imports for ESM compatibility with ts-jest
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  // moduleNameMapper: {
  //   // Si tienes alias de ruta en tsconfig.json, replícalos aquí
  //   // Ejemplo: '^@core/(.*)$': '<rootDir>/src/core/$1'
  // }
};