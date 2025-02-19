"use strict";

const fs = require('fs-extra').promises;
const _fs = require('fs-extra');
const rimraf = require('rimraf');
const { sh } = require('../sh');
const { source, to, process_files } = require('../config');
const createDir = require('../create-dir');
const exec = require('../execShellCommand');
const listFiles = require('../listFiles');
const path = require('../get-path');
const no_process = require('./no-process');
const postProcess = require('./post-process-replace');

const requiredResources = process_files.js['to-browser'].require;
const packageName = JSON.parse(_fs.readFileSync('.library/package.json', 'utf8'));

async function recursive_require(file, replace) {

   // let content = await fs.readFile(file, 'utf8');
   let content = await postProcess({ src: file, response: true, local: replace });
   const requireds = content.match(/require\(.*?\);/gim);
   
   for (const required in requireds) {

      let fixPath = requireds[required].replace(/\.\.\//gim, '').replace('./', '');
      const origins = requiredResources.split('/');
      if (origins.length > 1) origins.forEach(folder => fixPath = fixPath.replace(folder, ''));
      else fixPath = fixPath.replace(requiredResources, '');

      const regex = /(require\(['"`])(.+?)(['"`]\);)/;
      const requiredName = regex.exec(fixPath)[2].replace(RegExp(packageName.name.replace(/\//, '\\/'), 'gim'), '');
      const exist_require = () => {

         const required_path = `${requiredResources}/${requiredName}`;

         if (_fs.existsSync(`${required_path}/index.js`)) return `${required_path}/index.js`;
         
         throw(`O arquivo "${requiredName}" não foi encontrado na biblioteca`);
      };
      const require = exist_require();

      // Check module
      let current = await fs.readFile(require, 'utf8');
      current = current.replace(/(\/\*[\s\S]*?\*\/)|(\/{2}.*)|(^\s*$)/gim, '').trim();

      const outputModule = /(module.exports\s=\s(.*?);)/;
      const isModule = outputModule.test(current) ? outputModule.exec(current)[2] : false;

      if (typeof isModule !== 'boolean') current = current.replace(RegExp(`const\\s${isModule}\\s=\\s|module.*?;`, 'gm'), '').trim();

      /* Recursive Library */
      if (regex.test(current)) current = await recursive_require(require, replace);

      content = content.replace(requireds[required], current);
   }
   
   return content;
}

async function processJS(file, local = false, replace = 'dev') {

   const _ = /\.library/.test(file) ? true : false;

   if (_) {

      const filename =  file.split('/').pop().replace(/.js/, '');
      const regex = RegExp(`require.*?${filename}`);
      const files = await listFiles(source, 'js', requiredResources);

      for (const file in files) {

         const content = await fs.readFile(files[file], 'utf8');
         if (regex.test(content)) processJS(files[file], local);
      }

      return;
   }

   /* ------------------------------------------------------------- */

   const localTo = !local ? to : local;
   const tempDIR = `temp_${(new Date()).valueOf().toString()}`;
   const pre = file.replace(source, tempDIR);
   const tempJS = path(pre);
   const final = file.replace(source, localTo);

   createDir([ tempDIR, tempJS, tempJS.replace(tempDIR, localTo) ]);

   async function pre_process() {

      const content = await recursive_require(file, replace);

      /* Final Build File */
      await fs.writeFile(pre, content);
   }

   async function process() {

      let error = false;

      if (no_process(pre)) return;

      if (process_files.js.babel) {
         
         const request = await exec(`npx --quiet babel "${pre}" -o "${pre}"`); // Babel
         if (!request) error = true;
      }
      
      if (process_files.js.uglify) {
         
         const request = await exec(`npx --quiet uglifyjs "${pre}" -o "${pre}" -c -m`); // Uglify
         if (!request) error = true;
      }

      return error;
   }

   async function post_process() {

      let content = await fs.readFile(pre, 'utf8');
      await fs.writeFile(final, content);
   }

   /* ------------------------------------------------------------- */
      
   await pre_process();
   const request = await process();
   await post_process();

   if (_fs.existsSync(tempDIR)) rimraf(tempDIR, () => { });

   return !request;
}

module.exports = processJS;