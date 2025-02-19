"use strict";

const fs = require('fs-extra');
const fsep = require('fs-extra').promises;
const { sh, type, draft } = require('../../modules/sh');
const FTP = require('../../modules/ftp');
const { dev, source, to, process_files } = require('../../modules/config');
const createDir = require('../../modules/create-dir');
const empty = require('../../modules/empty');
const isConnected = require('../../modules/check-connection');
const listFiles = require('../../modules/listFiles');
const deleteDS_Store = require('../../modules/deleteDS_Store');
const watch = require('node-watch').default;
const processCSS = require('../../modules/process-files/process-scss');
const processJS = require('../../modules/process-files/process-js');
const processPHP = require('../../modules/process-files/process-php-phtml');
const processHTML = require('../../modules/process-files/process-html');
const processHTACCESS = require('../../modules/process-files/process-htaccess');
const postProcess = require('../../modules/process-files/post-process-replace');
const no_process = require('../../modules/process-files/no-process');
const path = require('../../modules/get-path');
const Schedule = require('../../modules/schedule');
const mime = require('mime-types');

module.exports = async () => {
   
   const loading = {
      
      ftp: new draft('', `dots`, false),
      building: new draft('', `dots`, false),
      status: new draft('', `dots`, false),
      deploy: new draft('', `dots`, false),
   };

   console.log();

   loading.ftp.start();
   loading.ftp.string = `${sh.bold}FTP:${sh.reset} ${sh.dim}Connecting`;

   loading.building.message(`${sh.dim}${sh.blue}◼${sh.reset}${sh.dim} Builder: ${sh.reset}${sh.blue}ready`);
   loading.status.message(`${sh.dim}${sh.blue}◼${sh.reset}${sh.dim} Status: ${sh.reset}${sh.blue}ready`);
   loading.deploy.message(`${sh.dim}${sh.blue}◼${sh.reset}${sh.dim} Deploy: ${sh.reset}${sh.blue}ready`);

   const { host, user, pass, root, secure } = dev.ftp;
   const pre_connect = !empty(host) || !empty(user) || !empty(pass) ? true : false;
   const conn = pre_connect ? await FTP.connect({ host: host, user: user, pass: pass, root: root, secure: secure }) : false;
   if (!conn) {
      
      FTP.client.close();
      loading.ftp.stop(0, `${sh.dim}${sh.bold}FTP:${sh.reset}${sh.dim} No connected`);
   }
   else loading.ftp.stop(1, `${sh.bold}FTP:${sh.reset} ${sh.dim}Connected`);

   const deploy = new Schedule();
   const watcherSource = watch(source, { recursive: true });
   const watcherMain = watch(to, { recursive: true });
   const watcherModules = watch('.library', { recursive: true });

   const onSrc = async (event, file) => {

      if (!!file.match(/DS_Store/)) {
         
         await deleteDS_Store();
         return;
      }

      if (file === `${source}/exit`) {
         
         FTP.client.close();
         watcherSource.close();
         watcherMain.close();
         watcherModules.close();

         return;
      }

      const isDir = file.split('/').pop().includes('.') ? false : true;
      if (event == 'update' && isDir) return;

      /* Verificar se o item já está em processamento */
      if (!deploy.scheduling?.file) deploy.scheduling.file = file;
      else if (deploy.scheduling.file === file) return;

      loading.building.message('');
      loading.status.message('');
      loading.deploy.message('');
      
      const fileType = file.split('.').pop().toLowerCase();
      const finalFile = file.replace(source, to);

      let pathFile = file.split('/'); pathFile.pop(); pathFile = pathFile.join('/');
      
      if (event === 'update') {

         loading.building.start();
         loading.building.string = `Building ${sh.dim}from${sh.reset} "${sh.bold}${type(file)}${file}${sh.reset}"`;

         let status = 1;
         
         /* pre processed files */
         if (fileType === 'js') {
            
            const request = await processJS(file);

            if (!request) status = 0;
         }
         else if (fileType === 'scss' || fileType === 'css') {
            
            const request = await processCSS(file);

            if (!request) status = 0;
         }
         else {
         
            /* post process */
            createDir(pathFile.replace(source, to));
   
            const original = await postProcess({src: file, response: true});
            let minified = false;
            
            /* specials */
            if (!no_process(file)) {

               if (fileType === 'php' || fileType === 'phtml') minified = await processPHP(original);
               else if (fileType === 'html')  minified = await processHTML(original);
               else if (fileType === 'htaccess')  minified = await processHTACCESS(original);
            }
   
            await fs.writeFile(finalFile, !minified ? original : minified);
         }

         loading.building.stop(status);

      }
      else if (event === 'remove') {

         loading.building.start();
         loading.building.string = `Removed ${sh.dim}from${sh.reset} "${sh.bold}${type(file)}${file}${sh.reset}"`;

         if (isDir) fs.rmSync(finalFile, { recursive: true, force: true });
         else {

            if (fs.existsSync(finalFile)) fs.unlinkSync(finalFile);
            if (fileType === 'scss') {

               if (fs.existsSync(finalFile.replace('.scss', '.css'))) fs.unlinkSync(finalFile.replace('.scss', '.css'));
            }
         }

         loading.building.stop(1);
      }
   }
   
   watcherSource.on('change', (event, file) => onSrc(event, file));
  
   watcherMain.on('change', async (event, file) => {

      if (!!file.match(/DS_Store/)) {
         
         await deleteDS_Store();
         return;
      }
      
      const connected = await isConnected();

      async function deployFile() {

         loading.status.start();
         loading.deploy.start();
      
         /* shows file or directory that is in attendance */
         if (event == 'update') {
            
            loading.status.stop(1, `Copied ${sh.dim}to${sh.reset} "${type(deploy.scheduling.current)}${sh.bold}${deploy.scheduling.current}${sh.reset}"`);
            if (connected && conn) loading.deploy.string = `Deploying ${sh.dim}to${sh.reset} "${type(deploy.scheduling.current)}${sh.bold}${deploy.scheduling.current.replace(to, FTP.publicCachedAccess.root)}${sh.reset}"`;
         }
         else {
            
            loading.status.stop(1, `Removed ${sh.dim}from${sh.reset} "${type(deploy.scheduling.current)}${sh.bold}${deploy.scheduling.current}${sh.reset}"`);
            if (connected && conn) loading.deploy.string = `Removing ${sh.dim}from${sh.reset} "${type(deploy.scheduling.current)}${sh.bold}${deploy.scheduling.current.replace(to, FTP.publicCachedAccess.root)}${sh.reset}"`;
         }
         
         if (connected && conn) {
            
            const action = event == 'update' ? await FTP.send(file, deploy) : await FTP.remove(file, isDir);
            loading.deploy.stop(!!action ? 1 : 0, FTP.client.error);
         }
         else if (!conn) loading.deploy.stop(0, `${sh.dim}${sh.bold}Deploying:${sh.reset}${sh.dim} No connection established`);
         else if (!connected) loading.deploy.stop(0, `${sh.dim}${sh.bold}Deploying:${sh.reset}${sh.dim} No connection established`);
      }
      
      const isDir = file.split('/').pop().includes('.') ? false : true;
      if (event == 'update' && isDir) return;
      
      /* Verificar se o item já está em processamento */
      if (!deploy.scheduling?.copying) deploy.scheduling.copying = file;
      else if (deploy.scheduling.copying === file) return;
      
      deploy.queue(deployFile, file);
      await deploy.start();

      loading.status.stop(1);
   });

   watcherModules.on('change', async (event, file) => {

      if (!!file.match(/DS_Store/)) {
         
         await deleteDS_Store();
         return;
      }

      const isDir = file.split('/').pop().includes('.') ? false : true;
      if (event == 'update' && isDir) return;

      const library = file.replace(/(\.library\/)|(\/index.js)/gim, '', file);
      const required = RegExp(`require.*?${library}`, 'gim');
      const requiredResources = process_files.js['to-browser'].require;
      const js = await listFiles(source, 'js', requiredResources);

      for (const dependence of js) {
         
         const file_dependence = fs.readFileSync(dependence, 'utf8');
         const to_process = !!file_dependence.match(required);

         to_process && await onSrc('update', dependence);
      }
   });

   return true;
};