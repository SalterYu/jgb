import * as glob from 'fast-glob';
import * as fs from 'fs';
import BabelPlugin from 'jgb-plugin-babel';
import CssPlugin from 'jgb-plugin-css';
import HtmlPlugin from 'jgb-plugin-html';
import JsonPlugin from 'jgb-plugin-json';
import JsonAsset from 'jgb-plugin-json/lib/JsonAsset';
import { declare, IInitOptions } from 'jgb-shared/lib';
import { ICompiler } from 'jgb-shared/lib/pluginDeclare';
import { pathToUnixType } from 'jgb-shared/lib/utils';
import * as Path from 'path';

interface IPluginConfig {
  coreOptions?: IInitOptions;
}

interface IAppTabBar {
  color: string;
  selectedColor: string;
  backgroundColor: string;
  borderStyle: string;
  list: IAppJsonTabarListConfg[];
  position: string;
}

interface IAppJson {
  pages: string[];
  tabBar: IAppTabBar;
  subPackages: Array<{
    root: string;
    pages: string[];
  }>;
}

interface IAppJsonTabarListConfg {
  pagePath: string;
  text: string;
  iconPath: string;
  selectedIconPath: string;
}

export interface IPageJson {
  usingComponents: {
    [componentName: string]: string;
  };
}

const EXT_REGEX = /\.(\w)+$/;

export default declare((compiler, pluginConfig: IPluginConfig = {}) => {
  if (pluginConfig && pluginConfig.coreOptions) {
    const entryFiles = []
      .concat(pluginConfig.coreOptions.entryFiles)
      .filter(Boolean);
    if (entryFiles.length === 0) {
      entryFiles.push('app.js', 'app.json', 'app.wxss');

      pluginConfig.coreOptions.entryFiles = entryFiles;
    }
  }

  attachCompilerEvent(compiler);

  BabelPlugin(compiler, {});
  JsonPlugin(compiler, {});
  HtmlPlugin(compiler, {
    extensions: ['.wxml'],
    outExt: '.wxml'
  });

  CssPlugin(compiler, {
    extensions: ['.wxss'],
    outExt: '.wxss'
  });
});

function attachCompilerEvent(compiler: ICompiler) {
  compiler.on('collect-app-json', collectAppJson);
  compiler.on('collect-page-json', collectPageJson);
}

export async function collectPageJson({
  dependences,
  pageJson,
  ctx
}: {
  dependences: Set<string>;
  pageJson: IPageJson;
  ctx: JsonAsset;
}) {
  // 是否使用组件
  if (
    !pageJson.usingComponents ||
    typeof pageJson.usingComponents !== 'object'
  ) {
    return;
  }
  const extensions = ctx.options.parser.extensions as Map<string, any>;
  const supportExtensions = extensions.keys();
  const components: string[] = [];

  const usingComponent = usingNpmComponents.bind(ctx);

  for (const [key, value] of Object.entries(pageJson.usingComponents)) {
    const componentPath = await findComponent(value, ctx);
    try {
      await usingComponent(
        key,
        componentPath,
        pageJson,
        dependences,
        components
      );
    } catch (error) {}
  }

  // expandFiles
  if (components.length > 0) {
    for (const dep of await ctx.expandFiles(
      new Set(components),
      supportExtensions
    )) {
      dependences.add(dep);
    }
  }
}

/**
 * 找到组件路径，并返回相对编译后的路径
 * @param componentPath
 */
export async function findComponent(componentPath: string, ctx: JsonAsset) {
  // resolve alias
  try {
    const realPath = await ctx.resolver.loadResolveAlias(componentPath);
    if (realPath) {
      componentPath = realPath;
    }
  } catch (error) {}

  if (componentPath.startsWith('.') || componentPath.startsWith('/')) {
    return componentPath;
  }

  const module = await ctx.resolver.resolveModule(componentPath, null);
  if (!module) {
    return componentPath;
  }

  const pkg =
    'moduleDir' in module && module.moduleDir
      ? await ctx.resolver.findPackage(module.moduleDir)
      : {};

  if (
    module.filePath &&
    (fs.existsSync(module.filePath) || fs.existsSync(module.filePath + '.json'))
  ) {
    return module.filePath;
  }
  // 根据pkg.miniprogram查找
  if (pkg.miniprogram) {
    const realComponentPath = Path.join(
      module.moduleDir,
      pkg.miniprogram,
      module.subPath
    );

    if (fs.existsSync(realComponentPath + '.json')) {
      return realComponentPath;
    }
  }
}

export async function usingNpmComponents(
  this: JsonAsset,
  key: string,
  value: string,
  pageJson: IPageJson,
  dependences: Set<string>,
  components: string[]
): Promise<boolean> {
  // let distPath = '';
  // let relativeRequirePath = '';
  // let realName = '';
  // let absolutePath = '';
  /**
   * value maybe:
   *  xxx/xx => 可能找不到文件，需要根据pkg.miniprogram
   *  xxx
   *  @xxx/xxx
   */
  const {
    distPath,
    relativeRequirePath,
    realName,
    absolutePath
  } = await this.resolveAliasName(value);

  if (distPath && relativeRequirePath) {
    const relativeRequire = relativeRequirePath.replace(EXT_REGEX, '');
    pageJson.usingComponents[key] = relativeRequire;
    if (realName) {
      // alias
      const componentPath = pathToUnixType(absolutePath.replace(EXT_REGEX, ''));
      components.push(componentPath);
    }

    if (absolutePath.includes('node_modules')) {
      // npm
      const pkgJson = await findPackage(this, Path.dirname(absolutePath));
      if (!pkgJson) {
        return;
      }
      const { pkg, dir } = pkgJson;
      // 如果配置了miniprogram小程序组件目录 会copy整个目录
      if (pkg.miniprogram) {
        const npmProjectDir = Path.join(dir, pkg.miniprogram);

        const allMatches = await glob.async(['**/**'], {
          cwd: npmProjectDir
        });
        if (allMatches) {
          allMatches.forEach((file: string) => {
            dependences.add(Path.join(npmProjectDir, file));
          });
          return true;
        }
      } else {
        // only resolve
        components.push(absolutePath.replace(EXT_REGEX, ''));
        return true;
      }
    }
  }
}

async function findPackage(ctx: JsonAsset, dir: string) {
  // Find the nearest package.json file within the current node_modules folder
  try {
    const pkg = await ctx.resolver.findPackage(dir);
    return {
      pkg,
      dir: pkg.pkgdir
    };
  } catch (err) {
    // ignore
  }
}

async function collectAppJson({
  dependences,
  appJson,
  ctx
}: {
  dependences: Set<string>;
  appJson: IAppJson;
  ctx: JsonAsset;
}) {
  const extensions = ctx.options.parser.extensions as Map<string, any>;
  const supportExtensions = extensions.keys();
  const assetPaths: string[] = [];

  // pages asset
  if (Array.isArray(appJson.pages)) {
    assetPaths.push(...appJson.pages);
  }

  // subPackages asset
  if (Array.isArray(appJson.subPackages)) {
    // tslint:disable-next-line:no-shadowed-variable
    appJson.subPackages.forEach(({ root, pages }) => {
      const subPackagePages = pages.map(page => Path.join(root, page));
      assetPaths.push(...subPackagePages);
    });
  }

  // expandFiles
  if (Array.isArray(assetPaths)) {
    for (const dep of await ctx.expandFiles(
      new Set(assetPaths),
      supportExtensions
    )) {
      dependences.add(dep);
    }
  }

  // tabBar asset
  if (appJson.tabBar && Array.isArray(appJson.tabBar.list)) {
    appJson.tabBar.list.forEach(config => {
      // tslint:disable-next-line:no-unused-expression
      config.iconPath && dependences.add(config.iconPath);
      // tslint:disable-next-line:no-unused-expression
      config.selectedIconPath && dependences.add(config.selectedIconPath);
    });
  }
}
