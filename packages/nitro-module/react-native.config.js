/**
 * Autolinking hints.
 *
 * The Android package is named explicitly so linking does not depend on
 * React Native inferring it from a source scan.
 */
module.exports = {
  dependency: {
    platforms: {
      android: {
        packageImportPath: 'import com.crossnative.CrossNativePackage;',
        packageInstance: 'new CrossNativePackage()',
      },
    },
  },
};
