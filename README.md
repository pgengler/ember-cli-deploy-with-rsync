# ember-cli-deploy-with-rsync [![CircleCI](https://circleci.com/gh/pgengler/ember-cli-deploy-with-rsync.svg?style=svg)](https://circleci.com/gh/pgengler/ember-cli-deploy-with-rsync)

> An ember-cli-deploy plugin to upload, activate and list versioned application file/s using rsync and SSH.

<hr/>
**WARNING: This plugin is only compatible with ember-cli-deploy versions >= 0.5.0**
<hr/>


This plugin uploads, activates and lists deployed revisions. It's mainly based on [ember-cli-deploy-ssh2](https://github.com/arenoir/ember-cli-deploy-ssh2) with some elements from [ember-cli-deploy-scp](https://github.com/michaljach/ember-cli-deploy-scp). The main difference from `ember-cli-deploy-ssh2` is that this plugin will copy all files from the build, rather than just a set of named files.


## Quick Start
To get up and running quickly, do the following:

- Ensure [ember-cli-deploy-build][1], [ember-cli-deploy-revision-data][3] and [ember-cli-deploy-display-revisions][4]) are installed and configured.

- Install this plugin

```bash
$ ember install ember-cli-deploy-with-rsync
```

- Place the following configuration into `config/deploy.js`

```javascript
ENV['with-rsync'] = {
  host: 'webserver1.example.com',
  username: 'production-deployer',
  privateKeyPath: '~/.ssh/id_rsa', // optional
  port: 22, // optional
  root: '/usr/local/www/my-application' // optional
}
```

- Run the pipeline

```bash
$ ember deploy
```

## Configuration Options

### host
  The host name or IP address of the machine to connect to.

*Default:* `''`

### username

  The username to use to open an SSH connection.

*Default:* `''`

### privateKeyPath

  The path to a private key to authenticate the ssh connection.

*Default:*  ```'~/.ssh/id_rsa'```

### passphrase

  The passphrase used to decrypt the privateKey.

*Default:*  ```none```

### port
  The port to connect on.

*Default:* ```'22'```

### root

  A function or string used to determine where to upload `applicationFiles`.

*Note:* ```This directory will not be created it must exist on server.``

*Default:* ```'/usr/local/www/' + context.project.name()```

### uploadDestination

  A string or a function returning the path where the application files are stored.

*Default:*
```
function(context){
  return path.join(this.readConfig('root'), 'revisions');
}
```

### activationDestination

  The path that the active version should be linked to.

*Default:*
```
function(context) {
  return path.join(this.readConfig('root'), 'active');
}
```

### activationStrategy

  How revisions are activated either by symlink or copying revision directory.

*Default:* ```"symlink"```


### revisionManifest

  A string or a function returning the path where the revision manifest is located.

*Default:*
```
function(context) {
  return path.join(this.readConfig('root'), 'revisions.json');
}
```

### revisionMeta
  A function returning a hash of meta data to include with the revision.

*Default:*
```
function(context) {
  var revisionKey = this.readConfig('revisionKey');
  var who = username.sync() + '@' + os.hostname();

  return {
    revision: revisionKey,
    deployer: who,
    timestamp: new Date().getTime(),
  }
}
```


## Prerequisites

The following properties are expected to be present on the deployment `context` object:

- `distDir`                     (provided by [ember-cli-deploy-build][2])
- `revisionData`                (provided by [ember-cli-deploy-revision-data][3])

The following commands require:

- `deploy:list`                 (provided by [ember-cli-deploy-display-revisions][4])



[1]: http://ember-cli.github.io/ember-cli-deploy/plugins "Plugin Documentation"
[2]: https://github.com/ember-cli-deploy/ember-cli-deploy-build "ember-cli-deploy-build"
[3]: https://github.com/ember-cli-deploy/ember-cli-deploy-revision-data "ember-cli-deploy-revision-data"
[4]: https://github.com/ember-cli-deploy/ember-cli-deploy-display-revisions "ember-cli-deploy-display-revisions"
