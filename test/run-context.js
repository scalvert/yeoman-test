'use strict';
var _ = require('lodash');
var os = require('os');
var fs = require('fs');
var path = require('path');
var assert = require('assert');
var sinon = require('sinon');
var inquirer = require('inquirer');
var RunContext = require('../lib/run-context');
var Generator = require('yeoman-generator');
var tmpdir = path.join(os.tmpdir(), 'yeoman-run-context');
var helpers = require('../lib');
var mkdirp = require('mkdirp');
var DummyPrompt = require('../lib/adapter').DummyPrompt;

describe('RunContext', function() {
  beforeEach(function() {
    process.chdir(__dirname);

    this.defaultInput = inquirer.prompts.input;
    this.execSpy = sinon.spy();
    const execSpy = this.execSpy;
    this.Dummy = class extends Generator {
      exec(...args) {
        execSpy.apply(this, args);
      }
    };

    this.ctx = new RunContext(this.Dummy);
  });

  afterEach(function(done) {
    process.chdir(__dirname);
    this.ctx.cleanTestDirectory();

    if (this.ctx.completed) {
      done();
      return;
    }

    this.ctx.on('end', done);
  });

  describe('constructor', function() {
    it('accept path parameter', function(done) {
      var ctx = new RunContext(require.resolve('./fixtures/generator-simple/app'));

      ctx
        .on('ready', function() {
          assert(ctx.env.get('simple:app'));
        })
        .on('end', done);
    });

    it('propagate generator error events', function(done) {
      var onceDone = _.once(done);
      var error = new Error();
      var Dummy = helpers.createDummyGenerator();
      var execSpy = sinon.stub().throws(error);
      var endSpy = sinon.spy();
      Dummy.prototype.exec = execSpy;
      Dummy.prototype.end = execSpy;
      var ctx = new RunContext(Dummy);

      ctx.on('error', function(err) {
        sinon.assert.calledOnce(execSpy);
        assert.equal(err, error);
        sinon.assert.notCalled(endSpy);
        onceDone();
      });
    });

    it('accept generator constructor parameter (and assign gen:test as namespace)', function(done) {
      this.ctx.on(
        'ready',
        function() {
          assert(this.ctx.env.get('gen:test'));
          done();
        }.bind(this)
      );
    });

    it('set namespace and resolved path in generator', function(done) {
      var ctx = new RunContext(this.Dummy, {
        resolved: 'path',
        namespace: 'simple:app'
      });

      ctx.on('ready', function() {
        assert.equal(ctx.env.get('simple:app').resolved, 'path');
        done();
      });
    });

    it('run the generator asynchronously', function(done) {
      assert(this.execSpy.notCalled);
      this.ctx.on(
        'end',
        function() {
          sinon.assert.calledOnce(this.execSpy);
          done();
        }.bind(this)
      );
    });

    it('reset mocked prompt after running', function(done) {
      this.ctx.on(
        'end',
        function() {
          assert.equal(this.defaultInput, inquirer.prompts.input);
          done();
        }.bind(this)
      );
    });

    it('automatically run in a random tmpdir', function(done) {
      this.ctx.on('end', function() {
        assert.notEqual(process.cwd(), __dirname);
        assert.equal(fs.realpathSync(os.tmpdir()), path.dirname(process.cwd()));
        done();
      });
    });

    it('allows an option to not automatically run in tmpdir', function(done) {
      var cwd = process.cwd();
      this.ctx.settings.tmpdir = false;
      this.ctx.on('end', function() {
        assert.equal(cwd, process.cwd());
        done();
      });
    });

    it('accepts settings', function() {
      var Dummy = helpers.createDummyGenerator();
      var ctx = new RunContext(Dummy, {
        tmpdir: false,
        resolved: 'path',
        namespace: 'simple:app'
      });
      assert.equal(ctx.settings.tmpdir, false);
      assert.equal(ctx.settings.resolved, 'path');
      assert.equal(ctx.settings.namespace, 'simple:app');
    });

    it('only run a generator once', function(done) {
      this.ctx.on(
        'end',
        function() {
          sinon.assert.calledOnce(this.execSpy);
          done();
        }.bind(this)
      );

      this.ctx._run();
      this.ctx._run();
    });

    it('set --force by default', function(done) {
      this.ctx.on(
        'end',
        function() {
          assert.equal(this.execSpy.firstCall.thisValue.options.force, true);
          done();
        }.bind(this)
      );
    });

    it('set --skip-install by default', function(done) {
      this.ctx.on(
        'end',
        function() {
          assert.equal(this.execSpy.firstCall.thisValue.options.skipInstall, true);
          done();
        }.bind(this)
      );
    });

    it('set --skip-cache by default', function(done) {
      this.ctx.on(
        'end',
        function() {
          assert.equal(this.execSpy.firstCall.thisValue.options.skipCache, true);
          done();
        }.bind(this)
      );
    });
  });

  describe('error handling', function() {
    function removeListeners(host, handlerName) {
      if (!host) {
        return;
      }

      // Store the original handlers for the host
      var originalHandlers = host.listeners(handlerName);
      // Remove the current handlers for the host
      host.removeAllListeners(handlerName);
      return originalHandlers;
    }

    function setListeners(host, handlerName, handlers) {
      if (!host) {
        return;
      }

      handlers.forEach(host.on.bind(host, handlerName));
    }

    function processError(host, handlerName, cb) {
      if (!host) {
        return;
      }

      host.once(handlerName, cb);
    }

    beforeEach(function() {
      this.originalHandlersProcess = removeListeners(process, 'uncaughtException');
      this.originalHandlersProcessDomain = removeListeners(process.domain, 'error');
    });

    afterEach(function() {
      setListeners(process, 'uncaughtException', this.originalHandlersProcess);
      setListeners(process.domain, 'error', this.originalHandlersProcessDomain);
    });

    it('throw an error when no listener is present', function(done) {
      var error = new Error('dummy exception');
      var execSpy = sinon.stub().throws(error);
      var errorHandler = function(err) {
        sinon.assert.calledOnce(execSpy);
        assert.equal(err, error);
        done();
      };

      // Tests can be run via 2 commands : 'gulp test' or 'mocha'
      // in 'mocha' case the error has to be caught using process.on('uncaughtException')
      // in 'gulp' case the error has to be caught using process.domain.on('error')
      // as we don't know in which case we are, we set the error handler for both
      processError(process, 'uncaughtException', errorHandler);
      processError(process.domain, 'error', errorHandler);

      var Dummy = helpers.createDummyGenerator();
      Dummy.prototype.exec = execSpy;

      setImmediate(function() {
        return new RunContext(Dummy);
      });
    });
  });

  describe('#toPromise()', function() {
    it('return a resolved promise with the target directory on success', function() {
      return this.ctx.toPromise().then(
        function(dir) {
          assert.equal(this.ctx.targetDirectory, dir);
        }.bind(this)
      );
    });

    it('returns a reject promise on error', function() {
      var error = new Error();
      var Dummy = helpers.createDummyGenerator();
      var execSpy = sinon.stub().throws(error);
      Dummy.prototype.exec = execSpy;
      var ctx = new RunContext(Dummy);

      return ctx.toPromise().catch(function(err) {
        assert.equal(err, error);
      });
    });
  });

  describe('#then()', function() {
    it('handle success', function() {
      return this.ctx.then(
        function(dir) {
          assert.equal(this.ctx.targetDirectory, dir);
        }.bind(this)
      );
    });

    it('handles errors', function() {
      var error = new Error();
      var Dummy = helpers.createDummyGenerator();
      var execSpy = sinon.stub().throws(error);
      Dummy.prototype.exec = execSpy;
      var ctx = new RunContext(Dummy);

      return ctx.then(
        function() {},
        function(err) {
          assert.equal(err, error);
        }
      );
    });
  });

  describe('#catch()', function() {
    it('handles errors', function() {
      var error = new Error();
      var Dummy = helpers.createDummyGenerator();
      var execSpy = sinon.stub().throws(error);
      Dummy.prototype.exec = execSpy;
      var ctx = new RunContext(Dummy);

      return ctx.catch(function(err) {
        assert.equal(err, error);
      });
    });
  });

  describe('#inDir()', function() {
    beforeEach(function() {
      process.chdir(__dirname);
      this.tmp = tmpdir;
    });

    it('call helpers.testDirectory()', function() {
      sinon.spy(helpers, 'testDirectory');
      this.ctx.inDir(this.tmp);
      assert(helpers.testDirectory.withArgs(this.tmp).calledOnce);
      helpers.testDirectory.restore();
    });

    it('is chainable', function() {
      assert.equal(this.ctx.inDir(this.tmp), this.ctx);
    });

    it('accepts optional `cb` to be invoked with resolved `dir`', function(done) {
      var ctx = new RunContext(this.Dummy);
      var cb = sinon.spy(
        function() {
          sinon.assert.calledOnce(cb);
          sinon.assert.calledOn(cb, ctx);
          sinon.assert.calledWith(cb, path.resolve(this.tmp));
        }.bind(this)
      );

      ctx.inDir(this.tmp, cb).on('end', done);
    });

    it('optional `cb` can use `this.async()` to delay execution', function(done) {
      var ctx = new RunContext(this.Dummy);
      var delayed = false;

      ctx
        .inDir(this.tmp, function() {
          var release = this.async();

          setTimeout(function() {
            delayed = true;
            release();
          }, 1);
        })
        .on('ready', function() {
          assert(delayed);
        })
        .on('end', done);
    });

    it('throws error at additional calls with dirPath', function() {
      assert(this.ctx.inDir(this.tmp));
      try {
        this.ctx.inDir(this.tmp);
        assert.fail();
      } catch (err) {
        assert(err.message.indexOf('Test directory has already been set.') !== -1);
      }
    });

    it('accepts `cb` alone to be invoked with resolved `dir`', function(done) {
      let cbCalled = false;
      this.ctx
        .inDir(this.tmp)
        .inDir(dirPath => {
          cbCalled = true;
          assert.equal(dirPath, this.tmp);
        })
        .on('end', () => {
          if (cbCalled) {
            done();
          }
        });
    });

    it('accepts multiples call with `cb` alone to be invoked with resolved `dir`', function(done) {
      let cbCalled1 = false;
      let cbCalled2 = false;
      this.ctx
        .inDir(this.tmp)
        .inDir(dirPath => {
          cbCalled1 = true;
          assert.equal(dirPath, this.tmp);
        })
        .inDir(dirPath => {
          cbCalled2 = true;
          assert.equal(dirPath, this.tmp);
        })
        .on('end', () => {
          if (cbCalled1 && cbCalled2) {
            done();
          }
        });
    });
  });

  describe('#cd()', function() {
    beforeEach(function() {
      process.chdir(__dirname);
      this.tmp = tmpdir;
      mkdirp.sync(tmpdir);
    });

    it('do not call helpers.testDirectory()', function() {
      sinon.spy(helpers, 'testDirectory');
      this.ctx.cd(this.tmp);
      assert(!helpers.testDirectory.calledOnce);
      helpers.testDirectory.restore();
    });

    it('is chainable', function() {
      assert.equal(this.ctx.cd(this.tmp), this.ctx);
    });

    it('should set inDirSet & targetDirectory', function() {
      assert(!this.ctx.inDirSet);
      assert(!this.ctx.targetDirectory);
      this.ctx.cd(this.tmp);
      assert.equal(this.ctx.inDirSet, true);
      assert.equal(this.ctx.targetDirectory, this.tmp);
    });

    it('should cd into created directory', function() {
      sinon.spy(process, 'chdir');
      this.ctx.cd(this.tmp);
      assert(process.chdir.calledWith(this.tmp));
      process.chdir.restore();
    });

    it('should throw error if directory do not exist', function() {
      try {
        this.ctx.cd(path.join(this.tmp, 'NOT_EXIST'));
        assert.fail();
      } catch (err) {
        assert(err.message.indexOf(this.tmp) !== -1);
      }
    });
  });

  describe('#inTmpDir', function() {
    it('call helpers.testDirectory()', function() {
      sinon.spy(helpers, 'testDirectory');
      this.ctx.inTmpDir();
      sinon.assert.calledOnce(helpers.testDirectory);
      helpers.testDirectory.restore();
    });

    it('is chainable', function() {
      assert.equal(this.ctx.inTmpDir(), this.ctx);
    });

    it('accepts optional `cb` to be invoked with resolved `dir`', function(done) {
      var ctx = this.ctx;
      var cb = sinon.spy(function(dir) {
        assert.equal(this, ctx);
        assert(dir.indexOf(os.tmpdir()) > -1);
      });

      this.ctx.inTmpDir(cb).on('end', done);
    });
  });

  describe('#withArguments()', function() {
    it('provide arguments to the generator when passed as Array', function(done) {
      this.ctx.withArguments(['one', 'two']);
      this.ctx.on(
        'end',
        function() {
          assert.deepEqual(this.execSpy.firstCall.thisValue.arguments, ['one', 'two']);
          done();
        }.bind(this)
      );
    });

    it('provide arguments to the generator when passed as String', function(done) {
      this.ctx.withArguments('foo bar');
      this.ctx.on(
        'end',
        function() {
          assert.deepEqual(this.execSpy.firstCall.thisValue.arguments, ['foo', 'bar']);
          done();
        }.bind(this)
      );
    });

    it('throws when arguments passed is neither a String or an Array', function() {
      assert.throws(this.ctx.withArguments.bind(this.ctx, { foo: 'bar' }));
    });

    it('is chainable', function(done) {
      this.ctx.withArguments('foo').withArguments('bar');
      this.ctx.on(
        'end',
        function() {
          assert.deepEqual(this.execSpy.firstCall.thisValue.arguments, ['foo', 'bar']);
          done();
        }.bind(this)
      );
    });
  });

  describe('#withOptions()', function() {
    it('provide options to the generator', function(done) {
      this.ctx.withOptions({ foo: 'bar' });
      this.ctx.on(
        'end',
        function() {
          assert.equal(this.execSpy.firstCall.thisValue.options.foo, 'bar');
          done();
        }.bind(this)
      );
    });

    it('allow default settings to be overriden', function(done) {
      this.ctx.withOptions({
        'skip-install': false,
        force: false
      });
      this.ctx.on(
        'end',
        function() {
          assert.equal(this.execSpy.firstCall.thisValue.options.skipInstall, false);
          assert.equal(this.execSpy.firstCall.thisValue.options.force, false);
          done();
        }.bind(this)
      );
    });

    it('camel case options', function(done) {
      this.ctx.withOptions({ 'foo-bar': false });
      this.ctx.on(
        'end',
        function() {
          assert.equal(this.execSpy.firstCall.thisValue.options['foo-bar'], false);
          assert.equal(this.execSpy.firstCall.thisValue.options.fooBar, false);
          done();
        }.bind(this)
      );
    });

    it('kebab case options', function(done) {
      this.ctx.withOptions({ barFoo: false });
      this.ctx.on(
        'end',
        function() {
          assert.equal(this.execSpy.firstCall.thisValue.options['bar-foo'], false);
          assert.equal(this.execSpy.firstCall.thisValue.options.barFoo, false);
          done();
        }.bind(this)
      );
    });

    it('is chainable', function(done) {
      this.ctx.withOptions({ foo: 'bar' }).withOptions({ john: 'doe' });
      this.ctx.on(
        'end',
        function() {
          var options = this.execSpy.firstCall.thisValue.options;
          assert.equal(options.foo, 'bar');
          assert.equal(options.john, 'doe');
          done();
        }.bind(this)
      );
    });
  });

  describe('#withPrompts()', function() {
    it('is call automatically', function() {
      const askFor = sinon.spy();
      const prompt = sinon.spy();
      this.Dummy.prototype.askFor = function() {
        askFor();
        return this.prompt({
          name: 'yeoman',
          type: 'input',
          message: 'Hey!',
          default: 'pass'
        }).then(function(answers) {
          assert.equal(answers.yeoman, 'pass');
          prompt();
        });
      };

      return this.ctx.toPromise().then(function() {
        sinon.assert.calledOnce(askFor);
        sinon.assert.calledOnce(prompt);
      });
    });

    it('mock the prompt', function() {
      const execSpy = sinon.spy();
      this.Dummy.prototype.askFor = function() {
        return this.prompt({
          name: 'yeoman',
          type: 'input',
          message: 'Hey!'
        }).then(function(answers) {
          assert.equal(answers.yeoman, 'yes please');
          execSpy();
        });
      };

      return this.ctx
        .withPrompts({ yeoman: 'yes please' })
        .toPromise()
        .then(function() {
          sinon.assert.calledOnce(execSpy);
        });
    });

    it('is chainable', function() {
      const execSpy = sinon.spy();
      this.Dummy.prototype.askFor = function() {
        return this.prompt([
          {
            name: 'yeoman',
            type: 'input',
            message: 'Hey!'
          },
          {
            name: 'yo',
            type: 'input',
            message: 'Yo!'
          }
        ]).then(function(answers) {
          execSpy();
          assert.equal(answers.yeoman, 'yes please');
          assert.equal(answers.yo, 'yo man');
        });
      };

      return this.ctx
        .withPrompts({ yeoman: 'yes please' })
        .withPrompts({ yo: 'yo man' })
        .toPromise()
        .then(function() {
          sinon.assert.calledOnce(execSpy);
        });
    });

    it('calls the callback', function() {
      const execSpy = sinon.spy();
      const promptSpy = sinon.fake.returns('yes please');
      this.Dummy.prototype.askFor = function() {
        return this.prompt({
          name: 'yeoman',
          type: 'input',
          message: 'Hey!'
        }).then(function(answers) {
          execSpy();
          assert.equal(answers.yeoman, 'yes please');
        });
      };

      return this.ctx
        .withPrompts({ yeoman: 'no please' }, promptSpy)
        .toPromise()
        .then(function() {
          sinon.assert.calledOnce(execSpy);
          sinon.assert.calledOnce(promptSpy);
          assert.equal(promptSpy.getCall(0).args[0], 'no please');
          assert.ok(promptSpy.getCall(0).thisValue instanceof DummyPrompt);
        });
    });
  });

  describe('#withGenerators()', function() {
    it('register paths', function(done) {
      this.ctx.withGenerators([require.resolve('./fixtures/generator-simple/app')]).on(
        'ready',
        function() {
          assert(this.ctx.env.get('simple:app'));
          done();
        }.bind(this)
      );
    });

    it('register mocked generator', function(done) {
      this.ctx.withGenerators([[helpers.createDummyGenerator(), 'dummy:gen']]).on(
        'ready',
        function() {
          assert(this.ctx.env.get('dummy:gen'));
          done();
        }.bind(this)
      );
    });

    it('allow multiple calls', function(done) {
      this.ctx
        .withGenerators([require.resolve('./fixtures/generator-simple/app')])
        .withGenerators([[helpers.createDummyGenerator(), 'dummy:gen']])
        .on(
          'ready',
          function() {
            assert(this.ctx.env.get('dummy:gen'));
            assert(this.ctx.env.get('simple:app'));
            done();
          }.bind(this)
        );
    });
  });

  describe('#withEnvironment()', function() {
    it('register paths', function(done) {
      this.ctx
        .withEnvironment(env => {
          env.register(require.resolve('./fixtures/generator-simple/app'));
          return env;
        })
        .on(
          'ready',
          function() {
            assert(this.ctx.env.get('simple:app'));
            done();
          }.bind(this)
        );
    });
  });

  describe('#withLocalConfig()', function() {
    it('provides config to the generator', function(done) {
      this.ctx
        .withLocalConfig({
          some: true,
          data: 'here'
        })
        .on(
          'ready',
          function() {
            assert.equal(this.ctx.generator.config.get('some'), true);
            assert.equal(this.ctx.generator.config.get('data'), 'here');
            done();
          }.bind(this)
        );
    });
  });
});
