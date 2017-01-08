/* jshint node: true */
'use strict';

const Promise          = require('ember-cli/lib/ext/promise');
const DeployPluginBase = require('ember-cli-deploy-plugin');
const path             = require('path');
const os               = require('os');
const username         = require('username');
const Rsync            = require('rsync');
const SSHClient        = require('./lib/ssh-client');

const defaultConfig = {
  distDir: (context) => context.distDir,
  host: '',
  username: '',
  password: null,
  privateKeyPath: '~/.ssh/id_rsa',
  rsyncFlags: 'rtvu',
  agent: null,
  port: 22,
  directory: 'tmp/deploy-dist/.',

  root(context) {
    return path.posix.join('/usr/local/www', context.project.name());
  },

  activationDestination(/*context*/) {
    let root = this.readConfig('root');

    return path.posix.join(root, 'active');
  },

  activationStrategy: 'symlink',

  uploadDestination(/*context*/) {
    let root = this.readConfig('root');

    return path.posix.join(root, 'revisions');
  },

  revisionManifest(/*context*/) {
    let root = this.readConfig('root');

    return path.posix.join(root, 'revisions.json');
  },

  revisionKey(context) {
    return (context.commandOptions && context.commandOptions.revision) || (context.revisionData && context.revisionData.revisionKey);
  },

  revisionMeta(/*context*/) {
    let revisionKey = this.readConfig('revisionKey');
    let who = username.sync() + '@' + os.hostname();

    return {
      revision: revisionKey,
      deployer: who,
      timestamp: new Date().getTime(),
    };
  },
};

class DeployPlugin extends DeployPluginBase {
  constructor(options) {
    super();
    this.name = options.name;
    this.defaultConfig = defaultConfig;
  }

  configure(context) {
    super.configure(this, context);

    let options = {
      host: this.readConfig('host'),
      username: this.readConfig('username'),
      password: this.readConfig('password'),
      port: this.readConfig('port'),
      privateKeyPath: this.readConfig('privateKeyPath'),
      passphrase: this.readConfig('passphrase'),
      agent: this.readConfig('agent')
    };

    this._client = new SSHClient(options);
    return this._client.connect(this);
  }

  activate(/*context*/) {
    let client = this._client;
    let revisionKey = this.readConfig('revisionKey');
    let activationDestination = this.readConfig('activationDestination');
    let uploadDestination = path.posix.join(this.readConfig('uploadDestination'), '/');
    let activeRevisionPath =  path.posix.join(uploadDestination, revisionKey, '/');
    let activationStrategy = this.readConfig('activationStrategy');
    let revisionData = {
      revisionData: {
        activatedRevisionKey: revisionKey
      }
    };
    let linkCmd;

    this.log('Activating revision ' + revisionKey);

    if (activationStrategy === 'copy') {
      linkCmd = 'cp -TR ' + activeRevisionPath + ' ' + activationDestination;
    } else {
      linkCmd = 'ln -fsn ' + activeRevisionPath + ' ' + activationDestination;
    }

    return new Promise((resolve, reject) => {
      client.exec(linkCmd).then(
        () => {
          this._activateRevisionManifest().then(
            resolve(revisionData),
            reject
          );
        },
        reject
      );
    });
  }

  fetchRevisions(context) {
    this.log('Fetching Revisions');

    return this._fetchRevisionManifest().then(
      (manifest) => context.revisions = manifest,
      (error) => this.log(error, { color: 'red' })
    );
  }

  upload(/*context*/) {
    return this._updateRevisionManifest().then(
      () => {
        this.log('Successfully uploaded updated manifest.', { verbose: true });

        return this._uploadApplicationFiles();
      },
      (error) => this.log(error, { color: 'red' })
    );
  }

  teardown(/*context*/) {
    return this._client.disconnect();
  }

  _uploadApplicationFiles(/*context*/) {
    let client = this._client;
    let revisionKey = this.readConfig('revisionKey');
    let uploadDestination = this.readConfig('uploadDestination');
    let destination = path.posix.join(uploadDestination, revisionKey);
    let generatedPath = this.readConfig('username') + '@' + this.readConfig('host') + ':' + destination;

    this.log('Uploading `applicationFiles` to ' + destination);

    client.exec('mkdir -p ' + destination).then(() => this._rsync(generatedPath));
  }

  _activateRevisionManifest(/*context*/) {
    let client = this._client;
    let revisionKey = this.readConfig('revisionKey');
    let fetching = this._fetchRevisionManifest();
    let manifestPath = this.readConfig('revisionManifest');

    return new Promise((resolve, reject) => {
      fetching.then(
        (manifest) => {
          manifest.forEach((rev) => {
            if (rev.revision = revisionKey) {
              rev.active = true;
            } else {
              delete rev['active'];
            }
            return rev;
          });

          let data = new Buffer(JSON.stringify(manifest), 'utf-8');

          client.upload(manifestPath, data, this).then(resolve, reject);
        },
        (error) => {
          this.log(error, { color: 'red' });
          reject(error);
        }
      );
    });
  }

  _updateRevisionManifest() {
    let revisionKey  = this.readConfig('revisionKey');
    let revisionMeta = this.readConfig('revisionMeta');
    let manifestPath = this.readConfig('revisionManifest');
    let client       = this._client;

    this.log('Updating `revisionManifest` ' + manifestPath, { verbose: true });

    return new Promise((resolve, reject) => {
      this._fetchRevisionManifest().then(
        (manifest) => {
          let existing = manifest.some((rev) => rev.revision === revisionKey);

          if (existing) {
            this.log('Revision ' + revisionKey + ' already added to `revisionManifest` moving on.', { verbose: true });
            resolve();
            return;
          }

          this.log('Adding ' + JSON.stringify(revisionMeta), { verbose: true });

          manifest.unshift(revisionMeta);

          let data = new Buffer(JSON.stringify(manifest), 'utf-8');

          client.upload(manifestPath, data).then(resolve, reject);
        },
        (error) => {
          this.log(error.message, { color: 'red' });
          reject(error);
        }
      );
    });
  }

  _fetchRevisionManifest() {
    let manifestPath = this.readConfig('revisionManifest');
    let client = this._client;

    return new Promise((resolve, reject) => {
      client.readFile(manifestPath).then(
        (manifest) => {
          this.log('fetched manifest ' + manifestPath, { verbose: true });

          resolve(JSON.parse(manifest));
        },
        (error) => {
          if (error.message === 'No such file') {
            this.log('Revision manifest not present building new one.', { verbose: true });

            resolve([ ]);
          } else {
            this.log(error.message, { color: 'red' });
            reject(error);
          }
        }
      );
    });
  }

  _rsync(destination) {
   let rsync = new Rsync()
     .shell('ssh -p ' + this.readConfig('port'))
     .flags(this.readConfig('rsyncFlags'))
     .source(this.readConfig('directory'))
     .destination(destination);

   if (this.readConfig('exclude')) {
     rsync.set('exclude', this.readConfig('exclude'));
   }

   if (this.readConfig('displayCommands')) {
     this.log(rsync.command());
   }

   rsync.execute(() => this.log('Done !'));
 }
}

module.exports = {
  name: 'ember-cli-deploy-with-rsync',

  createDeployPlugin(options) {
    return new DeployPlugin(options);
  }
};
