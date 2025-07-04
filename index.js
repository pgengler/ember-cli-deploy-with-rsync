/* eslint-env node */
'use strict';

const BasePlugin = require('ember-cli-deploy-plugin');
const path       = require('path');
const os         = require('os');
const username   = require('username');
const Rsync      = require('rsync');
const SSHClient  = require('./lib/ssh-client');
const tempWrite  = require('temp-write');

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

  activationDestination(context, pluginHelper) {
    let root = pluginHelper.readConfig('root');

    return path.posix.join(root, 'active');
  },

  activationStrategy: 'symlink',

  uploadDestination(context, pluginHelper) {
    let root = pluginHelper.readConfig('root');

    return path.posix.join(root, 'revisions');
  },

  revisionManifest(context, pluginHelper) {
    let root = pluginHelper.readConfig('root');

    return path.posix.join(root, 'revisions.json');
  },

  revisionKey(context) {
    return (context.commandOptions && context.commandOptions.revision) || (context.revisionData && context.revisionData.revisionKey);
  },

  revisionMeta(context, pluginHelper) {
    let revisionKey = pluginHelper.readConfig('revisionKey');
    let who = username.sync() + '@' + os.hostname();

    return {
      revision: revisionKey,
      deployer: who,
      timestamp: new Date().getTime(),
    };
  },
};

class DeployPlugin extends BasePlugin {
  constructor(options) {
    super();
    this.name = options.name;
    this.defaultConfig = defaultConfig;
    this._rsyncClientClass = Rsync;
    this._sshClient = SSHClient;
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
      agent: this.readConfig('agent') || process.env['SSH_AUTH_SOCK']
    };

    this._client = new this._sshClient(options);
    this._rsyncClient = new this._rsyncClientClass();
    return this._client.connect(options);
  }

  async activate(/*context*/) {
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

    await client.exec(linkCmd);
    await this._activateRevisionManifest();
    return revisionData;
  }

  async fetchRevisions(context) {
    this.log('Fetching Revisions');

    const manifest = await this._fetchRevisionManifest();
    context.revisions = manifest;
  }

  async upload(/*context*/) {
    await this._updateRevisionManifest();
    this.log('Successfully uploaded updated manifest.', { verbose: true });
    return this._uploadApplicationFiles();
  }

  teardown(/*context*/) {
    return this._client.disconnect();
  }

  async _uploadApplicationFiles(/*context*/) {
    let client = this._client;
    let revisionKey = this.readConfig('revisionKey');
    let uploadDestination = this.readConfig('uploadDestination');
    let destination = path.posix.join(uploadDestination, revisionKey);
    let generatedPath = this.readConfig('username') + '@' + this.readConfig('host') + ':' + destination;

    this.log('Uploading `applicationFiles` to ' + destination);

    await client.exec('mkdir -p ' + destination);
    await this._rsync(generatedPath);
    this.log('Finished uploading application files!');
  }

  async _activateRevisionManifest(/*context*/) {
    let client = this._client;
    let revisionKey = this.readConfig('revisionKey');
    let manifestPath = this.readConfig('revisionManifest');

    const manifest = await this._fetchRevisionManifest();
    manifest.forEach((rev) => {
      if (rev.revision == revisionKey) {
        rev.active = true;
      } else {
        delete rev['active'];
      }
      return rev;
    });

    let tmpFilePath = tempWrite.sync(JSON.stringify(manifest))
    return client.putFile(tmpFilePath, manifestPath);
  }

  async _updateRevisionManifest() {
    let revisionKey  = this.readConfig('revisionKey');
    let revisionMeta = this.readConfig('revisionMeta');
    let manifestPath = this.readConfig('revisionManifest');
    let client       = this._client;

    this.log('Updating `revisionManifest` ' + manifestPath, { verbose: true });

    const manifest = await this._fetchRevisionManifest();
    let existing = manifest.some((rev) => rev.revision === revisionKey);

    if (existing) {
      this.log('Revision ' + revisionKey + ' already added to `revisionManifest`; moving on.', { verbose: true });
      return;
    }
    this.log('Adding ' + JSON.stringify(revisionMeta), { verbose: true });
    manifest.unshift(revisionMeta);

    let tmpFilePath = tempWrite.sync(JSON.stringify(manifest));
    return client.putFile(tmpFilePath, manifestPath);
  }

  async _fetchRevisionManifest() {
    let manifestPath = this.readConfig('revisionManifest');
    let client = this._client;

    try {
      const manifest = await client.readFile(manifestPath);
      this.log('fetched manifest ' + manifestPath, { verbose: true });
      return JSON.parse(manifest);
    }
    catch (error) {
      if (error.message === 'No such file') {
        this.log('Revision manifest not present; building new one.', { verbose: true });

        return [];
      } else {
        throw error;
      }
    }
  }

  _rsync(destination) {
    let rsync = this._rsyncClient
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

    return new Promise((resolve, reject) => {
      rsync.execute((error/*, code, cmd*/) => {
        if (error) {
          reject(error);
        }
        return resolve();
      }, (stdout) => this.log(stdout, { verbose: true }), (stderr) => this.log(stderr, { color: 'red', verbose: true }));
    });
  }
}

module.exports = {
  name: 'ember-cli-deploy-with-rsync',

  createDeployPlugin(options) {
    return new DeployPlugin(options);
  }
};
