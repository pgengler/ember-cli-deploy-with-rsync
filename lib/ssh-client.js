/* eslint-env node */
'use strict';

const SSH2Client = require('ssh2').Client;
const fs         = require('fs');
const untildify  = require('untildify');

class SSHClient {
  constructor(options) {
    if (options.agent) {
      delete options['privateKeyPath'];
    }

    if (options.privateKeyPath) {
      options.privateKey = fs.readFileSync(untildify(options.privateKeyPath));
    }

    this.options = options;
    this.client  = new SSH2Client();
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.client.on('error', reject);
      this.client.on('ready', resolve);

      this.client.connect(this.options);
    });
  }

  disconnect() {
    return new Promise((resolve, reject) => {
      this.client.on('error', reject);
      this.client.on('end', resolve);

      this.client.end();
    });
  }

  upload(path, data) {
    return new Promise((resolve, reject) => {
      this.client.sftp((error, sftp) => {
        if (error) {
          reject(error);
        }

        let stream = sftp.createWriteStream(path);

        stream.on('error', reject);
        stream.on('finish', resolve);
        stream.write(data);
        stream.end();
      });
    });
  }

  readFile(path) {
    return new Promise((resolve, reject) => {
      this.client.sftp((error, sftp) => {
        if (error) {
          reject(error);
        }

        sftp.readFile(path, { }, function(error, data) {
          if (error) {
            reject(error);
          } else {
            resolve(data);
          }
        });
      });
    });
  }

  exec(command) {
    return new Promise((resolve, reject) => {
      this.client.exec(command, (err/*, stream*/) => {
        if (err) {
          reject(err);
        }
        resolve();
      });
    });
  }

  putFile(src, dest) {
    return new Promise((resolve, reject) => {
      let parts = dest.split('/');
      parts.pop();
      let destdir = parts.join('/');
      let scpcmd  = 'mkdir -p ' + destdir;

      this.exec(scpcmd).then(() => {
        this.client.sftp(function (err, sftp) {
          if (err) {
            reject(err);
          }

          sftp.fastPut(src, dest, {}, function (err) {
            if (err) {
              reject(err);
            }
            resolve();
          });
        });
      }, reject);
    });
  }
}

module.exports = SSHClient;
