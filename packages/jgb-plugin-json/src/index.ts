import { declare } from 'jgb-shared/lib';
import JsonAsset from './JsonAsset';

const defaultExts = ['.json'];

export default declare((compiler, pluginConfig = {}) => {
  const exts = defaultExts.concat(pluginConfig.extensions || []);
  if (pluginConfig.outExt) {
    JsonAsset.outExt = pluginConfig.outExt;
  }
  compiler.addAssetsType(exts, JsonAsset);
});
