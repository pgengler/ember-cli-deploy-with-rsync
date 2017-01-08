/* jshint node: true */
'use strict';

const Promise    = require('ember-cli/lib/ext/promise');
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
    let client  = this.client;
    let options = this.options;

    client.connect(options);

    return new Promise(function(resolve, reject) {
      client.on('error', reject);
      client.on('ready', resolve);
    });
  }

  disconnect() {
    let client = this.client;

    client.end();

    return new Promise(function(resolve, reject) {
      client.on('error', reject);
      client.on('end', resolve);
    });
  }

  upload(path, data) {
    let client = this.client;

    return new Promise(function (resolve, reject) {
      client.sftp(function(error, sftp) {
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
    let client = this.client;

    return new Promise(function(resolve, reject) {
      client.sftp(function(error, sftp) {
        if (error) {
          reject(error);
        }

        sftp.readFile(path, {}, function (error, data) {
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
    let client = this.client;
    return new Promise(function(resolve, reject) {
      client.exec(command, function(err/*, stream*/) {
        if (err) {
          reject(err);
        }
        resolve();
      });
    });
  }

  putFile(src, dest) {
    let client = this.client;

    return new Promise((resolve, reject) => {
      let parts = dest.split('/');
      parts.pop();
      let destdir = parts.join('/');
      let scpcmd  = 'mkdir -p ' + destdir;

      this.exec(scpcmd).then(
        function() {
          client.sftp(function (err, sftp) {
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
        },
        reject
      );
    });
  }
}

module.exports = SSHClient;
