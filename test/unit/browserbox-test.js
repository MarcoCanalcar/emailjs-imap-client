'use strict';

(function(factory) {
    if (typeof define === 'function' && define.amd) {
        define(['chai', 'browserbox', 'imap-handler', './fixtures/mime-torture-bodystructure', './fixtures/envelope'], factory.bind(null, sinon));
    } else if (typeof exports === 'object') {
        module.exports = factory(require('sinon'), require('chai'), require('../../src/browserbox'), require('wo-imap-handler'), require('./fixtures/mime-torture-bodystructure'), require('./fixtures/envelope'));
    }
}(function(sinon, chai, BrowserBox, imapHandler, mimeTorture, testEnvelope) {
    var expect = chai.expect;
    chai.Assertion.includeStack = true;

    describe('browserbox unit tests', () => {
        var br;

        beforeEach(() => {
            br = new BrowserBox();
            br.client.socket = {
                send: () => {},
                upgradeToSecure: () => {}
            };
        });

        /* jshint indent:false */

        describe('#_onClose', () => {
            it('should emit onclose', () => {
                sinon.stub(br, 'onclose');

                br._onClose();

                expect(br.onclose.callCount).to.equal(1);

                br.onclose.restore();
            });
        });

        describe('#_onTimeout', () => {
            it('should emit onerror and call destroy', () => {
                br.onerror = () => {}; // not defined by default
                sinon.stub(br, 'onerror');
                sinon.stub(br.client, '_destroy');

                br._onTimeout();

                expect(br.onerror.callCount).to.equal(1);
                expect(br.client._destroy.callCount).to.equal(1);

                br.onerror.restore();
                br.client._destroy.restore();
            });
        });

        describe('#_onReady', () => {
            it('should call updateCapability', () => {
                sinon.stub(br, 'updateCapability').returns(Promise.resolve(true));

                br._onReady();

                expect(br.updateCapability.callCount).to.equal(1);
                expect(br.state).to.equal(br.STATE_NOT_AUTHENTICATED);

                br.updateCapability.restore();
            });
        });

        describe('#_onIdle', () => {
            it('should call enterIdle', () => {
                sinon.stub(br, 'enterIdle');

                br.authenticated = true;
                br._enteredIdle = false;
                br._onIdle();

                expect(br.enterIdle.callCount).to.equal(1);

                br.enterIdle.restore();
            });

            it('should not call enterIdle', () => {
                sinon.stub(br, 'enterIdle');

                br._enteredIdle = true;
                br._onIdle();

                expect(br.enterIdle.callCount).to.equal(0);

                br.enterIdle.restore();
            });
        });

        describe('#connect', () => {
            it('should initiate tcp connection', () => {
                sinon.stub(br.client, 'connect');

                br.connect();

                expect(br.client.connect.callCount).to.equal(1);

                clearTimeout(br._connectionTimeout);
                br.client.connect.restore();
            });

            it('should timeout if connection is not created', (done) => {
                sinon.stub(br.client, 'connect');
                sinon.stub(br, '_onTimeout', () => {

                    expect(br.client.connect.callCount).to.equal(1);

                    br.client.connect.restore();
                    br._onTimeout.restore();

                    done();
                });

                br.TIMEOUT_CONNECTION = 1;
                br.connect();
            });
        });

        describe('#close', () => {
            it('should send LOGOUT', (done) => {
                sinon.stub(br.client, 'close');
                sinon.stub(br, 'exec').withArgs('LOGOUT').returns(Promise.resolve());

                br.close().then(() => {
                    // the close call comes after the current event loop iteration hass been handled.
                    setTimeout(() => {
                        expect(br.state).to.equal(br.STATE_LOGOUT);
                        expect(br.client.close.calledOnce).to.be.true;
                        br.exec.restore();
                        br.client.close.restore();
                        done();
                    }, 0);
                });
            });
        });

        describe('#exec', () => {
            beforeEach(() => {
                sinon.stub(br, 'breakIdle', () => {
                    return Promise.resolve();
                });
            });

            afterEach(() => {
                br.client.exec.restore();
                br.breakIdle.restore();
            });

            it('should send string command', (done) => {
                sinon.stub(br.client, 'exec', function() {
                    arguments[arguments.length - 1]({});
                });
                br.exec('TEST').then((res) => {
                    expect(res).to.deep.equal({});
                    expect(br.client.exec.args[0][0]).to.equal('TEST');
                }).then(done).catch(done);
            });

            it('should update capability from response', (done) => {
                sinon.stub(br.client, 'exec', function() {
                    arguments[arguments.length - 1]({
                        capability: ['A', 'B']
                    });
                });
                br.exec('TEST').then((res) => {
                    expect(res).to.deep.equal({
                        capability: ['A', 'B']
                    });
                    expect(br.capability).to.deep.equal(['A', 'B']);
                }).then(done).catch(done);
            });

            it('should return error on NO/BAD', (done) => {
                sinon.stub(br.client, 'exec', function() {
                    arguments[arguments.length - 1]({
                        command: 'NO'
                    });
                });
                br.exec('TEST').catch((err) => {
                    expect(err).to.exist;
                    done();
                });
            });
        });

        describe('#enterIdle', () => {
            it('should periodically send NOOP if IDLE not supported', (done) => {
                sinon.stub(br, 'exec', (command) => {
                    expect(command).to.equal('NOOP');

                    br.exec.restore();
                    done();
                });

                br.capability = [];
                br.TIMEOUT_NOOP = 1;
                br.enterIdle();
            });

            it('should break IDLE after timeout', (done) => {
                sinon.stub(br.client, 'exec');
                sinon.stub(br.client.socket, 'send', (payload) => {

                    expect(br.client.exec.args[0][0].command).to.equal('IDLE');
                    expect([].slice.call(new Uint8Array(payload))).to.deep.equal([0x44, 0x4f, 0x4e, 0x45, 0x0d, 0x0a]);

                    br.client.socket.send.restore();
                    br.client.exec.restore();
                    done();
                });

                br.capability = ['IDLE'];
                br.TIMEOUT_IDLE = 1;
                br.enterIdle();
            });
        });

        describe('#breakIdle', () => {
            it('should send DONE to socket', (done) => {
                sinon.stub(br.client.socket, 'send');

                br._enteredIdle = 'IDLE';
                br.breakIdle().then(() => {
                    expect([].slice.call(new Uint8Array(br.client.socket.send.args[0][0]))).to.deep.equal([0x44, 0x4f, 0x4e, 0x45, 0x0d, 0x0a]);
                    br.client.socket.send.restore();
                }).then(done).catch(done);
            });
        });

        describe('#upgradeConnection', () => {
            describe('Skip upgrade', () => {
                it('should do nothing if already secured', (done) => {
                    br.client.secureMode = true;
                    br.capability = ['starttls'];
                    br.upgradeConnection().then((upgraded) => {
                        expect(upgraded).to.be.false;
                    }).then(done).catch(done);
                });

                it('should do nothing if STARTTLS not available', (done) => {
                    br.client.secureMode = false;
                    br.capability = [];
                    br.upgradeConnection().then((upgraded) => {
                        expect(upgraded).to.be.false;
                    }).then(done).catch(done);
                });
            });

            it('should run STARTTLS', (done) => {
                sinon.stub(br.client, 'upgrade').yields(null, false);
                sinon.stub(br, 'exec').withArgs('STARTTLS').returns(Promise.resolve());
                sinon.stub(br, 'updateCapability').returns(Promise.resolve());

                br.capability = ['STARTTLS'];

                br.upgradeConnection().then((upgraded) => {
                    expect(upgraded).to.be.false;

                    expect(br.client.upgrade.callCount).to.equal(1);
                    expect(br.capability.length).to.equal(0);

                    br.exec.restore();
                    br.client.upgrade.restore();
                    br.updateCapability.restore();
                }).then(done).catch(done);
            });

        });

        describe('#updateCapability', () => {
            beforeEach(() => {
                sinon.stub(br, 'exec');
            });

            afterEach(() => {
                br.exec.restore();
            });

            it('should do nothing if capability is set', (done) => {
                br.capability = ['abc'];
                br.updateCapability().then((updated) => {
                    expect(updated).to.be.false;
                }).then(done).catch(done);
            });

            it('should run CAPABILITY if capability not set', (done) => {
                br.exec.returns(Promise.resolve());

                br.capability = [];

                br.updateCapability().then(() => {
                    expect(br.exec.args[0][0]).to.equal('CAPABILITY');
                }).then(done).catch(done);
            });

            it('should force run CAPABILITY', (done) => {
                br.exec.returns(Promise.resolve());
                br.capability = ['abc'];

                br.updateCapability(true).then(() => {
                    expect(br.exec.args[0][0]).to.equal('CAPABILITY');
                }).then(done).catch(done);
            });

            it('should do nothing if connection is not yet upgraded', (done) => {
                br.capability = [];
                br.client.secureMode = false;
                br.options.requireTLS = true;

                br.updateCapability().then((updated) => {
                    expect(updated).to.be.false;
                }).then(done).catch(done);
            });
        });

        describe('#listNamespaces', () => {
            beforeEach(() => {
                sinon.stub(br, 'exec');
            });

            afterEach(() => {
                br.exec.restore();
            });

            it('should run NAMESPACE if supported', (done) => {
                br.exec.returns(Promise.resolve({
                    payload: {
                        NAMESPACE: [{
                            attributes: [
                                [
                                    [{
                                        type: 'STRING',
                                        value: 'INBOX.'
                                    }, {
                                        type: 'STRING',
                                        value: '.'
                                    }]
                                ], null, null
                            ]
                        }]
                    }
                }));
                br.capability = ['NAMESPACE'];

                br.listNamespaces().then((namespaces) => {
                    expect(namespaces).to.deep.equal({
                        personal: [{
                            prefix: 'INBOX.',
                            delimiter: '.'
                        }],
                        users: false,
                        shared: false
                    });
                    expect(br.exec.args[0][0]).to.equal('NAMESPACE');
                    expect(br.exec.args[0][1]).to.equal('NAMESPACE');
                }).then(done).catch(done);
            });

            it('should do nothing if not supported', (done) => {
                br.capability = [];
                br.listNamespaces().then((namespaces) => {
                    expect(namespaces).to.be.false;
                    expect(br.exec.callCount).to.equal(0);
                }).then(done).catch(done);
            });
        });

        describe('#compressConnection', () => {
            beforeEach(() => {
                sinon.stub(br, 'exec');
                sinon.stub(br.client, 'enableCompression');
            });

            afterEach(() => {
                br.exec.restore();
                br.client.enableCompression.restore();
            });

            it('should run COMPRESS=DEFLATE if supported', (done) => {
                br.exec.withArgs({
                    command: 'COMPRESS',
                    attributes: [{
                        type: 'ATOM',
                        value: 'DEFLATE'
                    }]
                }).returns(Promise.resolve({}));

                br.options.enableCompression = true;
                br.capability = ['COMPRESS=DEFLATE'];
                br.compressConnection().then((result) => {
                    expect(result).to.be.true;

                    expect(br.exec.callCount).to.equal(1);
                    expect(br.client.enableCompression.callCount).to.equal(1);
                }).then(done).catch(done);
            });

            it('should do nothing if not supported', (done) => {
                br.capability = [];

                br.compressConnection().then((result) => {
                    expect(result).to.be.false;
                    expect(br.exec.callCount).to.equal(0);
                }).then(done).catch(done);
            });

            it('should do nothing if not enabled', (done) => {
                br.options.enableCompression = false;
                br.capability = ['COMPRESS=DEFLATE'];

                br.compressConnection().then((result) => {
                    expect(result).to.be.false;
                    expect(br.exec.callCount).to.equal(0);
                }).then(done).catch(done);
            });
        });

        describe('#login', () => {
            it('should call LOGIN', (done) => {
                sinon.stub(br, 'exec').returns(Promise.resolve({}));
                sinon.stub(br, 'updateCapability').returns(Promise.resolve(true));

                br.login({
                    user: 'u1',
                    pass: 'p1'
                }).then(() => {
                    expect(br.exec.callCount).to.equal(1);
                    expect(br.exec.args[0][0]).to.deep.equal({
                        command: 'login',
                        attributes: [{
                            type: 'STRING',
                            value: 'u1'
                        }, {
                            type: 'STRING',
                            value: 'p1',
                            sensitive: true
                        }]
                    });

                    br.exec.restore();
                    done();
                });

            });

            it('should call XOAUTH2', () => {
                sinon.stub(br, 'exec').returns(Promise.resolve({}));
                sinon.stub(br, 'updateCapability').returns(Promise.resolve(true));

                br.capability = ['AUTH=XOAUTH2'];
                br.login({
                    user: 'u1',
                    xoauth2: 'abc'
                }).then(() => {
                    expect(br.exec.callCount).to.equal(1);
                    expect(br.exec.args[0][0]).to.deep.equal({
                        command: 'AUTHENTICATE',
                        attributes: [{
                            type: 'ATOM',
                            value: 'XOAUTH2'
                        }, {
                            type: 'ATOM',
                            value: 'dXNlcj11MQFhdXRoPUJlYXJlciBhYmMBAQ==',
                            sensitive: true
                        }]
                    });

                    br.exec.restore();
                });
            });
        });

        describe('#updateId', () => {
            beforeEach(() => {
                sinon.stub(br, 'exec');
            });

            afterEach(() => {
                br.exec.restore();
            });

            it('should not nothing if not supported', (done) => {
                br.capability = [];

                br.updateId({
                    a: 'b',
                    c: 'd'
                }).then((id) => {
                    expect(id).to.be.false;
                }).then(done).catch(done);
            });

            it('should send NIL', (done) => {
                br.exec.withArgs({
                    command: 'ID',
                    attributes: [
                        null
                    ]
                }).returns(Promise.resolve({
                    payload: {
                        ID: [{
                            attributes: [
                                null
                            ]
                        }]
                    }
                }));
                br.capability = ['ID'];

                br.updateId(null).then((id) => {
                    expect(id).to.deep.equal({});
                }).then(done).catch(done);
            });

            it('should exhange ID values', (done) => {
                br.exec.withArgs({
                    command: 'ID',
                    attributes: [
                        ['ckey1', 'cval1', 'ckey2', 'cval2']
                    ]
                }).returns(Promise.resolve({
                    payload: {
                        ID: [{
                            attributes: [
                                [{
                                    value: 'skey1'
                                }, {
                                    value: 'sval1'
                                }, {
                                    value: 'skey2'
                                }, {
                                    value: 'sval2'
                                }]
                            ]
                        }]
                    }
                }));
                br.capability = ['ID'];

                br.updateId({
                    ckey1: 'cval1',
                    ckey2: 'cval2'
                }).then((id) => {
                    expect(id).to.deep.equal({
                        skey1: 'sval1',
                        skey2: 'sval2'
                    });
                }).then(done).catch(done);
            });
        });

        describe('#listMailboxes', () => {
            beforeEach(() => {
                sinon.stub(br, 'exec');
            });

            afterEach(() => {
                br.exec.restore();
            });

            it('should call LIST and LSUB in sequence', (done) => {
                br.exec.withArgs({
                    command: 'LIST',
                    attributes: ['', '*']
                }).returns(Promise.resolve({
                    payload: {
                        LIST: [false]
                    }
                }));

                br.exec.withArgs({
                    command: 'LSUB',
                    attributes: ['', '*']
                }).returns(Promise.resolve({
                    payload: {
                        LSUB: [false]
                    }
                }));

                br.listMailboxes().then((tree) => {
                    expect(tree).to.exist;
                }).then(done).catch(done);
            });

            it('should not die on NIL separators', (done) => {
                br.exec.withArgs({
                    command: 'LIST',
                    attributes: ['', '*']
                }).returns(Promise.resolve({
                    payload: {
                        LIST: [
                            imapHandler.parser('* LIST (\\NoInferiors) NIL "INBOX"')
                        ]
                    }
                }));

                br.exec.withArgs({
                    command: 'LSUB',
                    attributes: ['', '*']
                }).returns(Promise.resolve({
                    payload: {
                        LSUB: [
                            imapHandler.parser('* LSUB (\\NoInferiors) NIL "INBOX"')
                        ]
                    }
                }));

                br.listMailboxes().then((tree) => {
                    expect(tree).to.exist;
                }).then(done).catch(done);
            });
        });

        describe('#createMailbox', () => {
            beforeEach(() => {
                sinon.stub(br, 'exec');
            });

            afterEach(() => {
                br.exec.restore();
            });

            it('should call CREATE with a string payload', (done) => {
                // The spec allows unquoted ATOM-style syntax too, but for
                // simplicity we always generate a string even if it could be
                // expressed as an atom.
                br.exec.withArgs({
                    command: 'CREATE',
                    attributes: ['mailboxname']
                }).returns(Promise.resolve());

                br.createMailbox('mailboxname').then((alreadyExists) => {
                    expect(alreadyExists).to.be.false;
                    expect(br.exec.callCount).to.equal(1);
                }).then(done).catch(done);
            });

            it('should call mutf7 encode the argument', (done) => {
                // From RFC 3501
                br.exec.withArgs({
                    command: 'CREATE',
                    attributes: ['~peter/mail/&U,BTFw-/&ZeVnLIqe-']
                }).returns(Promise.resolve());

                br.createMailbox('~peter/mail/\u53f0\u5317/\u65e5\u672c\u8a9e').then((alreadyExists) => {
                    expect(alreadyExists).to.be.false;
                    expect(br.exec.callCount).to.equal(1);
                }).then(done).catch(done);
            });

            it('should treat an ALREADYEXISTS response as success', (done) => {
                var fakeErr = {
                    code: 'ALREADYEXISTS'
                };
                br.exec.withArgs({
                    command: 'CREATE',
                    attributes: ['mailboxname']
                }).returns(Promise.reject(fakeErr));

                br.createMailbox('mailboxname').then((alreadyExists) => {
                    expect(alreadyExists).to.be.true;
                    expect(br.exec.callCount).to.equal(1);
                }).then(done).catch(done);
            });
        });

        describe('#listMessages', () => {
            beforeEach(() => {
                sinon.stub(br, 'exec');
                sinon.stub(br, '_buildFETCHCommand');
                sinon.stub(br, '_parseFETCH');
            });

            afterEach(() => {
                br.exec.restore();
                br._buildFETCHCommand.restore();
                br._parseFETCH.restore();
            });

            it('should call FETCH', (done) => {
                br.exec.returns(Promise.resolve('abc'));
                br._buildFETCHCommand.withArgs(['1:2', ['uid', 'flags'], {
                    byUid: true
                }]).returns({});

                br.listMessages('1:2', ['uid', 'flags'], {
                    byUid: true
                }).then(() => {
                    expect(br._buildFETCHCommand.callCount).to.equal(1);
                    expect(br._parseFETCH.withArgs('abc').callCount).to.equal(1);
                }).then(done).catch(done);
            });
        });

        describe('#search', () => {
            beforeEach(() => {
                sinon.stub(br, 'exec');
                sinon.stub(br, '_buildSEARCHCommand');
                sinon.stub(br, '_parseSEARCH');
            });

            afterEach(() => {
                br.exec.restore();
                br._buildSEARCHCommand.restore();
                br._parseSEARCH.restore();
            });


            it('should call SEARCH', (done) => {
                br.exec.returns(Promise.resolve('abc'));
                br._buildSEARCHCommand.withArgs({
                    uid: 1
                }, {
                    byUid: true
                }).returns({});

                br.search({
                    uid: 1
                }, {
                    byUid: true
                }).then(() => {
                    expect(br._buildSEARCHCommand.callCount).to.equal(1);
                    expect(br.exec.callCount).to.equal(1);
                    expect(br._parseSEARCH.withArgs('abc').callCount).to.equal(1);
                }).then(done).catch(done);
            });
        });

        describe('#upload', () => {
            beforeEach(() => {
                sinon.stub(br, 'exec');
            });

            afterEach(() => {
                br.exec.restore();
            });

            it('should call APPEND with custom flag', (done) => {
                br.exec.returns(Promise.resolve());

                br.upload('mailbox', 'this is a message', {
                    flags: ['\\$MyFlag']
                }).then((success) => {
                    expect(success).to.be.true;
                    expect(br.exec.callCount).to.equal(1);
                }).then(done).catch(done);
            });

            it('should call APPEND w/o flags', (done) => {
                br.exec.returns(Promise.resolve());

                br.upload('mailbox', 'this is a message').then((success) => {
                    expect(success).to.be.true;
                    expect(br.exec.callCount).to.equal(1);
                }).then(done).catch(done);
            });
        });

        describe('#setFlags', () => {
            beforeEach(() => {
                sinon.stub(br, 'exec');
                sinon.stub(br, '_buildSTORECommand');
                sinon.stub(br, '_parseFETCH');
            });

            afterEach(() => {
                br.exec.restore();
                br._buildSTORECommand.restore();
                br._parseFETCH.restore();
            });

            it('should call STORE', (done) => {
                br.exec.returns(Promise.resolve('abc'));
                br._buildSTORECommand.withArgs('1:2','FLAGS',['\\Seen', '$MyFlag'], {
                    byUid: true
                }).returns({});

                br.setFlags('1:2', ['\\Seen', '$MyFlag'], {
                    byUid: true
                }).then(() => {
                    expect(br.exec.callCount).to.equal(1);
                    expect(br._parseFETCH.withArgs('abc').callCount).to.equal(1);
                }).then(done).catch(done);
            });
        });

        describe('#store', () => {
            beforeEach(() => {
                sinon.stub(br, 'exec');
                sinon.stub(br, '_buildSTORECommand');
                sinon.stub(br, '_parseFETCH');
            });

            afterEach(() => {
                br.exec.restore();
                br._buildSTORECommand.restore();
                br._parseFETCH.restore();
            });

            it('should call STORE', (done) => {
                br.exec.returns(Promise.resolve('abc'));
                br._buildSTORECommand.withArgs('1:2', '+X-GM-LABELS', ['\\Sent', '\\Junk'], {
                    byUid: true
                }).returns({});

                br.store('1:2', '+X-GM-LABELS', ['\\Sent', '\\Junk'], {
                    byUid: true
                }).then(() => {
                    expect(br._buildSTORECommand.callCount).to.equal(1);
                    expect(br.exec.callCount).to.equal(1);
                    expect(br._parseFETCH.withArgs('abc').callCount).to.equal(1);
                }).then(done).catch(done);
            });
        });

        describe('#deleteMessages', () => {
            beforeEach(() => {
                sinon.stub(br, 'setFlags');
                sinon.stub(br, 'exec');
            });

            afterEach(() => {
                br.setFlags.restore();
                br.exec.restore();
            });

            it('should call UID EXPUNGE', (done) => {
                br.exec.withArgs({
                    command: 'UID EXPUNGE',
                    attributes: [{
                        type: 'sequence',
                        value: '1:2'
                    }]
                }).returns(Promise.resolve('abc'));
                br.setFlags.withArgs('1:2', {
                    add: '\\Deleted'
                }).returns(Promise.resolve());

                br.capability = ['UIDPLUS'];
                br.deleteMessages('1:2', {
                    byUid: true
                }).then(() => {
                    expect(br.exec.callCount).to.equal(1);
                }).then(done).catch(done);
            });

            it('should call EXPUNGE', (done) => {
                br.exec.withArgs('EXPUNGE').returns(Promise.resolve('abc'));
                br.setFlags.withArgs('1:2', {
                    add: '\\Deleted'
                }).returns(Promise.resolve());

                br.capability = [];
                br.deleteMessages('1:2', {
                    byUid: true
                }).then(() => {
                    expect(br.exec.callCount).to.equal(1);
                }).then(done).catch(done);
            });
        });

        describe('#copyMessages', () => {
            beforeEach(() => {
                sinon.stub(br, 'exec');
            });

            afterEach(() => {
                br.exec.restore();
            });

            it('should call COPY', (done) => {
                br.exec.withArgs({
                    command: 'UID COPY',
                    attributes: [{
                        type: 'sequence',
                        value: '1:2'
                    }, {
                        type: 'atom',
                        value: '[Gmail]/Trash'
                    }]
                }).returns(Promise.resolve({
                    humanReadable: 'abc'
                }));

                br.copyMessages('1:2', '[Gmail]/Trash', {
                    byUid: true
                }).then((response) => {
                    expect(response).to.equal('abc');
                    expect(br.exec.callCount).to.equal(1);
                }).then(done).catch(done);
            });
        });

        describe('#moveMessages', () => {
            beforeEach(() => {
                sinon.stub(br, 'exec');
                sinon.stub(br, 'copyMessages');
                sinon.stub(br, 'deleteMessages');
            });

            afterEach(() => {
                br.exec.restore();
                br.copyMessages.restore();
                br.deleteMessages.restore();
            });

            it('should call MOVE if supported', (done) => {
                br.exec.withArgs({
                    command: 'UID MOVE',
                    attributes: [{
                        type: 'sequence',
                        value: '1:2'
                    }, {
                        type: 'atom',
                        value: '[Gmail]/Trash'
                    }]
                }, ['OK']).returns(Promise.resolve('abc'));

                br.capability = ['MOVE'];
                br.moveMessages('1:2', '[Gmail]/Trash', {
                    byUid: true
                }).then(() => {
                    expect(br.exec.callCount).to.equal(1);
                }).then(done).catch(done);
            });

            it('should fallback to copy+expunge', (done) => {
                br.copyMessages.withArgs('1:2', '[Gmail]/Trash', {
                    byUid: true
                }).returns(Promise.resolve());
                br.deleteMessages.withArgs('1:2', {
                    byUid: true
                }).returns(Promise.resolve());

                br.capability = [];
                br.moveMessages('1:2', '[Gmail]/Trash', {
                    byUid: true
                }).then(() => {
                    expect(br.deleteMessages.callCount).to.equal(1);
                }).then(done).catch(done);
            });
        });

        describe('#selectMailbox', () => {
            beforeEach(() => {
                sinon.stub(br, 'exec');
                sinon.stub(br, '_parseSELECT');
            });

            afterEach(() => {
                br.exec.restore();
                br._parseSELECT.restore();
            });

            it('should run SELECT', (done) => {
                br.exec.withArgs({
                    command: 'SELECT',
                    attributes: [{
                        type: 'STRING',
                        value: '[Gmail]/Trash'
                    }]
                }).returns(Promise.resolve('abc'));

                br.selectMailbox('[Gmail]/Trash').then(() => {
                    expect(br.exec.callCount).to.equal(1);
                    expect(br._parseSELECT.withArgs('abc').callCount).to.equal(1);
                    expect(br.state).to.equal(br.STATE_SELECTED);
                }).then(done).catch(done);
            });

            it('should run SELECT with CONDSTORE', (done) => {
                br.exec.withArgs({
                    command: 'SELECT',
                    attributes: [{
                            type: 'STRING',
                            value: '[Gmail]/Trash'
                        },
                        [{
                            type: 'ATOM',
                            value: 'CONDSTORE'
                        }]
                    ]
                }).returns(Promise.resolve('abc'));

                br.capability = ['CONDSTORE'];
                br.selectMailbox('[Gmail]/Trash', {
                    condstore: true
                }).then(() => {
                    expect(br.exec.callCount).to.equal(1);
                    expect(br._parseSELECT.withArgs('abc').callCount).to.equal(1);
                    expect(br.state).to.equal(br.STATE_SELECTED);
                }).then(done).catch(done);
            });

            it('should emit onselectmailbox', (done) => {
                br.exec.returns(Promise.resolve('abc'));
                br._parseSELECT.withArgs('abc').returns('def');

                br.onselectmailbox = (path, mailbox) => {
                    expect(path).to.equal('[Gmail]/Trash');
                    expect(mailbox).to.equal('def');
                    done();
                };

                br.selectMailbox('[Gmail]/Trash').then(() => {
                    expect(br._parseSELECT.callCount).to.equal(1);
                }).catch(done);
            });

            it('should emit onclosemailbox', (done) => {
                br.exec.returns(Promise.resolve('abc'));
                br._parseSELECT.withArgs('abc').returns('def');

                br.onclosemailbox = (path) => expect(path).to.equal('yyy');

                br.selectedMailbox = 'yyy';
                br.selectMailbox('[Gmail]/Trash').then(() => {
                    expect(br._parseSELECT.callCount).to.equal(1);
                }).then(done).catch(done);
            });
        });

        describe('#hasCapability', () => {
            it('should detect existing capability', () => {
                br.capability = ['ZZZ'];
                expect(br.hasCapability('zzz')).to.be.true;
            });

            it('should detect non existing capability', () => {
                br.capability = ['ZZZ'];
                expect(br.hasCapability('ooo')).to.be.false;
                expect(br.hasCapability()).to.be.false;
            });
        });

        describe('#_untaggedOkHandler', () => {
            it('should update capability if present', () => {
                br._untaggedOkHandler({
                    capability: ['abc']
                }, () => {});
                expect(br.capability).to.deep.equal(['abc']);
            });
        });

        describe('#_untaggedCapabilityHandler', () => {
            it('should update capability', () => {
                br._untaggedCapabilityHandler({
                    attributes: [{
                        value: 'abc'
                    }]
                }, () => {});
                expect(br.capability).to.deep.equal(['ABC']);
            });
        });

        describe('#_untaggedExistsHandler', () => {
            it('should emit onupdate', () => {
                sinon.stub(br, 'onupdate');

                br._untaggedExistsHandler({
                    nr: 123
                }, () => {});
                expect(br.onupdate.withArgs('exists', 123).callCount).to.equal(1);

                br.onupdate.restore();
            });
        });

        describe('#_untaggedExpungeHandler', () => {
            it('should emit onupdate', () => {
                sinon.stub(br, 'onupdate');

                br._untaggedExpungeHandler({
                    nr: 123
                }, () => {});
                expect(br.onupdate.withArgs('expunge', 123).callCount).to.equal(1);

                br.onupdate.restore();
            });
        });

        describe('#_untaggedFetchHandler', () => {
            it('should emit onupdate', () => {
                sinon.stub(br, 'onupdate');
                sinon.stub(br, '_parseFETCH').returns('abc');

                br._untaggedFetchHandler({
                    nr: 123
                }, () => {});
                expect(br.onupdate.withArgs('fetch', 'abc').callCount).to.equal(1);
                expect(br._parseFETCH.args[0][0]).to.deep.equal({
                    payload: {
                        FETCH: [{
                            nr: 123
                        }]
                    }
                });

                br.onupdate.restore();
                br._parseFETCH.restore();
            });
        });

        describe('#_parseSELECT', () => {
            it('should parse a complete response', () => {
                expect(br._parseSELECT({
                    code: 'READ-WRITE',
                    payload: {
                        EXISTS: [{
                            nr: 123
                        }],
                        FLAGS: [{
                            attributes: [
                                [{
                                    type: 'ATOM',
                                    value: '\\Answered'
                                }, {
                                    type: 'ATOM',
                                    value: '\\Flagged'
                                }]
                            ]
                        }],
                        OK: [{
                            code: 'PERMANENTFLAGS',
                            permanentflags: ['\\Answered', '\\Flagged']
                        }, {
                            code: 'UIDVALIDITY',
                            uidvalidity: '2'
                        }, {
                            code: 'UIDNEXT',
                            uidnext: '38361'
                        }, {
                            code: 'HIGHESTMODSEQ',
                            highestmodseq: '3682918'
                        }]
                    }
                })).to.deep.equal({
                    exists: 123,
                    flags: ['\\Answered', '\\Flagged'],
                    highestModseq: '3682918',
                    permanentFlags: ['\\Answered', '\\Flagged'],
                    readOnly: false,
                    uidNext: 38361,
                    uidValidity: 2
                });
            });

            it('should parse response with no modseq', () => {
                expect(br._parseSELECT({
                    code: 'READ-WRITE',
                    payload: {
                        EXISTS: [{
                            nr: 123
                        }],
                        FLAGS: [{
                            attributes: [
                                [{
                                    type: 'ATOM',
                                    value: '\\Answered'
                                }, {
                                    type: 'ATOM',
                                    value: '\\Flagged'
                                }]
                            ]
                        }],
                        OK: [{
                            code: 'PERMANENTFLAGS',
                            permanentflags: ['\\Answered', '\\Flagged']
                        }, {
                            code: 'UIDVALIDITY',
                            uidvalidity: '2'
                        }, {
                            code: 'UIDNEXT',
                            uidnext: '38361'
                        }]
                    }
                })).to.deep.equal({
                    exists: 123,
                    flags: ['\\Answered', '\\Flagged'],
                    permanentFlags: ['\\Answered', '\\Flagged'],
                    readOnly: false,
                    uidNext: 38361,
                    uidValidity: 2
                });
            });

            it('should parse response with read-only', () => {
                expect(br._parseSELECT({
                    code: 'READ-ONLY',
                    payload: {
                        EXISTS: [{
                            nr: 123
                        }],
                        FLAGS: [{
                            attributes: [
                                [{
                                    type: 'ATOM',
                                    value: '\\Answered'
                                }, {
                                    type: 'ATOM',
                                    value: '\\Flagged'
                                }]
                            ]
                        }],
                        OK: [{
                            code: 'PERMANENTFLAGS',
                            permanentflags: ['\\Answered', '\\Flagged']
                        }, {
                            code: 'UIDVALIDITY',
                            uidvalidity: '2'
                        }, {
                            code: 'UIDNEXT',
                            uidnext: '38361'
                        }]
                    }
                })).to.deep.equal({
                    exists: 123,
                    flags: ['\\Answered', '\\Flagged'],
                    permanentFlags: ['\\Answered', '\\Flagged'],
                    readOnly: true,
                    uidNext: 38361,
                    uidValidity: 2
                });
            });

            it('should parse response with NOMODSEQ flag', () => {
                expect(br._parseSELECT({
                    code: 'READ-WRITE',
                    payload: {
                        EXISTS: [{
                            nr: 123
                        }],
                        FLAGS: [{
                            attributes: [
                                [{
                                    type: 'ATOM',
                                    value: '\\Answered'
                                }, {
                                    type: 'ATOM',
                                    value: '\\Flagged'
                                }]
                            ]
                        }],
                        OK: [{
                            code: 'PERMANENTFLAGS',
                            permanentflags: ['\\Answered', '\\Flagged']
                        }, {
                            code: 'UIDVALIDITY',
                            uidvalidity: '2'
                        }, {
                            code: 'UIDNEXT',
                            uidnext: '38361'
                        }, {
                            code: 'NOMODSEQ'
                        }]
                    }
                })).to.deep.equal({
                    exists: 123,
                    flags: ['\\Answered', '\\Flagged'],
                    permanentFlags: ['\\Answered', '\\Flagged'],
                    readOnly: false,
                    uidNext: 38361,
                    uidValidity: 2,
                    noModseq: true
                });
            });
        });

        describe('#_parseNAMESPACE', () => {
            it('should not succeed for no namespace response', () => {
                expect(br._parseNAMESPACE({
                    payload: {
                        NAMESPACE: []
                    }
                })).to.be.false;
            });

            it('should return single personal namespace', () => {
                expect(br._parseNAMESPACE({
                    payload: {
                        NAMESPACE: [{
                            attributes: [
                                [
                                    [{
                                        type: 'STRING',
                                        value: 'INBOX.'
                                    }, {
                                        type: 'STRING',
                                        value: '.'
                                    }]
                                ], null, null
                            ]
                        }]
                    }
                })).to.deep.equal({
                    personal: [{
                        prefix: 'INBOX.',
                        delimiter: '.'
                    }],
                    users: false,
                    shared: false
                });
            });

            it('should return single personal, single users, multiple shared', () => {
                expect(br._parseNAMESPACE({
                    payload: {
                        NAMESPACE: [{
                            attributes: [
                                // personal
                                [
                                    [{
                                        type: 'STRING',
                                        value: ''
                                    }, {
                                        type: 'STRING',
                                        value: '/'
                                    }]
                                ],
                                // users
                                [
                                    [{
                                        type: 'STRING',
                                        value: '~'
                                    }, {
                                        type: 'STRING',
                                        value: '/'
                                    }]
                                ],
                                // shared
                                [
                                    [{
                                        type: 'STRING',
                                        value: '#shared/'
                                    }, {
                                        type: 'STRING',
                                        value: '/'
                                    }],
                                    [{
                                        type: 'STRING',
                                        value: '#public/'
                                    }, {
                                        type: 'STRING',
                                        value: '/'
                                    }]
                                ]
                            ]
                        }]
                    }
                })).to.deep.equal({
                    personal: [{
                        prefix: '',
                        delimiter: '/'
                    }],
                    users: [{
                        prefix: '~',
                        delimiter: '/'
                    }],
                    shared: [{
                        prefix: '#shared/',
                        delimiter: '/'
                    }, {
                        prefix: '#public/',
                        delimiter: '/'
                    }]
                });
            });

            it('should handle NIL namespace hierarchy delim', () => {
                expect(br._parseNAMESPACE({
                    payload: {
                        NAMESPACE: [
                            // This specific value is returned by yahoo.co.jp's
                            // imapgate version 0.7.68_11_1.61475 IMAP server
                            imapHandler.parser('* NAMESPACE (("" NIL)) NIL NIL')
                        ]
                    }
                })).to.deep.equal({
                    personal: [{
                        prefix: '',
                        delimiter: null
                    }],
                    users: false,
                    shared: false
                });
            });
        });

        describe('#_buildFETCHCommand', () => {
            it('should build single ALL', () => {
                expect(br._buildFETCHCommand('1:*', ['all'], {})).to.deep.equal({
                    command: 'FETCH',
                    attributes: [{
                        type: 'SEQUENCE',
                        value: '1:*'
                    }, {
                        type: 'ATOM',
                        value: 'ALL'
                    }]
                });
            });

            it('should build FETCH with uid', () => {
                expect(br._buildFETCHCommand('1:*', ['all'], {
                    byUid: true
                })).to.deep.equal({
                    command: 'UID FETCH',
                    attributes: [{
                        type: 'SEQUENCE',
                        value: '1:*'
                    }, {
                        type: 'ATOM',
                        value: 'ALL'
                    }]
                });
            });

            it('should build FETCH with uid, envelope', () => {
                expect(br._buildFETCHCommand('1:*', ['uid', 'envelope'], {})).to.deep.equal({
                    command: 'FETCH',
                    attributes: [{
                            type: 'SEQUENCE',
                            value: '1:*'
                        },
                        [{
                            type: 'ATOM',
                            value: 'UID'
                        }, {
                            type: 'ATOM',
                            value: 'ENVELOPE'
                        }]
                    ]
                });
            });

            it('should build FETCH with modseq', () => {
                expect(br._buildFETCHCommand('1:*', ['modseq (1234567)'], {})).to.deep.equal({
                    command: 'FETCH',
                    attributes: [{
                            type: 'SEQUENCE',
                            value: '1:*'
                        },
                        [{
                                type: 'ATOM',
                                value: 'MODSEQ'
                            },
                            [{
                                type: 'ATOM',
                                value: '1234567'
                            }]
                        ]
                    ]
                });
            });

            it('should build FETCH with section', () => {
                expect(br._buildFETCHCommand('1:*', ['body[text]'], {})).to.deep.equal({
                    command: 'FETCH',
                    attributes: [{
                        type: 'SEQUENCE',
                        value: '1:*'
                    }, {
                        type: 'ATOM',
                        value: 'BODY',
                        section: [{
                            type: 'ATOM',
                            value: 'TEXT'
                        }]
                    }]
                });
            });

            it('should build FETCH with section and list', () => {
                expect(br._buildFETCHCommand('1:*', ['body[header.fields (date in-reply-to)]'], {})).to.deep.equal({
                    command: 'FETCH',
                    attributes: [{
                        type: 'SEQUENCE',
                        value: '1:*'
                    }, {
                        type: 'ATOM',
                        value: 'BODY',
                        section: [{
                                type: 'ATOM',
                                value: 'HEADER.FIELDS'
                            },
                            [{
                                type: 'ATOM',
                                value: 'DATE'
                            }, {
                                type: 'ATOM',
                                value: 'IN-REPLY-TO'
                            }]
                        ]
                    }]
                });
            });

            it('should build FETCH with ', () => {
                expect(br._buildFETCHCommand('1:*', ['all'], {
                    changedSince: '123456'
                })).to.deep.equal({
                    command: 'FETCH',
                    attributes: [{
                            type: 'SEQUENCE',
                            value: '1:*'
                        }, {
                            type: 'ATOM',
                            value: 'ALL'
                        },
                        [{
                            type: 'ATOM',
                            value: 'CHANGEDSINCE'
                        }, {
                            type: 'ATOM',
                            value: '123456'
                        }]
                    ]
                });
            });

            it('should build FETCH with partial', () => {
                expect(br._buildFETCHCommand('1:*', ['body[]'], {})).to.deep.equal({
                    command: 'FETCH',
                    attributes: [{
                        type: 'SEQUENCE',
                        value: '1:*'
                    }, {
                        type: 'ATOM',
                        value: 'BODY',
                        section: []
                    }]
                });
            });
        });

        describe('#_parseFETCH', () => {
            it('should return values lowercase keys', () => {
                sinon.stub(br, '_parseFetchValue').returns('def');
                expect(br._parseFETCH({
                    payload: {
                        FETCH: [{
                            nr: 123,
                            attributes: [
                                [{
                                    type: 'ATOM',
                                    value: 'BODY',
                                    section: [{
                                            type: 'ATOM',
                                            value: 'HEADER'
                                        },
                                        [{
                                            type: 'ATOM',
                                            value: 'DATE'
                                        }, {
                                            type: 'ATOM',
                                            value: 'SUBJECT'
                                        }]
                                    ],
                                    partial: [0, 123]
                                }, {
                                    type: 'ATOM',
                                    value: 'abc'
                                }]
                            ]
                        }]
                    }
                })).to.deep.equal([{
                    '#': 123,
                    'body[header (date subject)]<0.123>': 'def'
                }]);

                expect(br._parseFetchValue.withArgs('body[header (date subject)]<0.123>', {
                    type: 'ATOM',
                    value: 'abc'
                }).callCount).to.equal(1);

                br._parseFetchValue.restore();
            });

            it('should merge multiple responses based on sequence number', () => {
                expect(br._parseFETCH({
                    payload: {
                        FETCH: [{
                            nr: 123,
                            attributes: [
                                [{
                                    type: 'ATOM',
                                    value: 'UID'
                                }, {
                                    type: 'ATOM',
                                    value: 789
                                }]
                            ]
                        }, {
                            nr: 124,
                            attributes: [
                                [{
                                    type: 'ATOM',
                                    value: 'UID'
                                }, {
                                    type: 'ATOM',
                                    value: 790
                                }]
                            ]
                        }, {
                            nr: 123,
                            attributes: [
                                [{
                                    type: 'ATOM',
                                    value: 'MODSEQ'
                                }, {
                                    type: 'ATOM',
                                    value: '127'
                                }]
                            ]
                        }]
                    }
                })).to.deep.equal([{
                    '#': 123,
                    'uid': 789,
                    'modseq': '127'
                }, {
                    '#': 124,
                    'uid': 790
                }]);
            });
        });

        describe('#_parseENVELOPE', () => {
            it('should parsed envelope object', () => {
                expect(br._parseENVELOPE(testEnvelope.source)).to.deep.equal(testEnvelope.parsed);
            });
        });

        describe('#_parseBODYSTRUCTURE', () => {
            it('should parse bodystructure object', () => {
                expect(br._parseBODYSTRUCTURE(mimeTorture.source)).to.deep.equal(mimeTorture.parsed);
            });

            it('should parse bodystructure with unicode filename', () => {
                var input = [
                    [{
                            type: 'STRING',
                            value: 'APPLICATION'
                        }, {
                            type: 'STRING',
                            value: 'OCTET-STREAM'
                        },
                        null,
                        null,
                        null, {
                            type: 'STRING',
                            value: 'BASE64'
                        }, {
                            type: 'ATOM',
                            value: '40'
                        },
                        null, [{
                                type: 'STRING',
                                value: 'ATTACHMENT'
                            },
                            [{
                                type: 'STRING',
                                value: 'FILENAME'
                            }, {
                                type: 'STRING',
                                value: '=?ISO-8859-1?Q?BBR_Handel,_Gewerbe,_B=FCrobetriebe,?= =?ISO-8859-1?Q?_private_Bildungseinrichtungen.txt?='
                            }]
                        ],
                        null
                    ], {
                        type: 'STRING',
                        value: 'MIXED'
                    },
                    [{
                        type: 'STRING',
                        value: 'BOUNDARY'
                    }, {
                        type: 'STRING',
                        value: '----sinikael-?=_1-14105085265110.49903922458179295'
                    }],
                    null,
                    null
                ];

                var expected = {
                    childNodes: [{
                        part: '1',
                        type: 'application/octet-stream',
                        encoding: 'base64',
                        size: 40,
                        disposition: 'attachment',
                        dispositionParameters: {
                            filename: 'BBR Handel, Gewerbe, Bürobetriebe, private Bildungseinrichtungen.txt'
                        }
                    }],
                    type: 'multipart/mixed',
                    parameters: {
                        boundary: '----sinikael-?=_1-14105085265110.49903922458179295'
                    }
                };

                expect(br._parseBODYSTRUCTURE(input)).to.deep.equal(expected);
            });
        });

        describe('#_buildSEARCHCommand', () => {
            it('should compose a search command', () => {
                expect(br._buildSEARCHCommand({
                    unseen: true,
                    header: ['subject', 'hello world'],
                    or: {
                        unseen: true,
                        seen: true
                    },
                    not: {
                        seen: true
                    },
                    sentbefore: new Date(2011, 1, 3, 12, 0, 0),
                    since: new Date(2011, 11, 23, 12, 0, 0),
                    uid: '1:*',
                    'X-GM-MSGID': '1499257647490662970',
                    'X-GM-THRID': '1499257647490662971'
                }, {})).to.deep.equal({
                    command: 'SEARCH',
                    attributes: [{
                        'type': 'atom',
                        'value': 'UNSEEN'
                    }, {
                        'type': 'atom',
                        'value': 'HEADER'
                    }, {
                        'type': 'string',
                        'value': 'subject'
                    }, {
                        'type': 'string',
                        'value': 'hello world'
                    }, {
                        'type': 'atom',
                        'value': 'OR'
                    }, {
                        'type': 'atom',
                        'value': 'UNSEEN'
                    }, {
                        'type': 'atom',
                        'value': 'SEEN'
                    }, {
                        'type': 'atom',
                        'value': 'NOT'
                    }, {
                        'type': 'atom',
                        'value': 'SEEN'
                    }, {
                        'type': 'atom',
                        'value': 'SENTBEFORE'
                    }, {
                        'type': 'atom',
                        'value': '3-Feb-2011'
                    }, {
                        'type': 'atom',
                        'value': 'SINCE'
                    }, {
                        'type': 'atom',
                        'value': '23-Dec-2011'
                    }, {
                        'type': 'atom',
                        'value': 'UID'
                    }, {
                        'type': 'sequence',
                        'value': '1:*'
                    }, {
                        'type': 'atom',
                        'value': 'X-GM-MSGID'
                    }, {
                        'type': 'number',
                        'value': '1499257647490662970'
                    }, {
                        'type': 'atom',
                        'value': 'X-GM-THRID'
                    }, {
                        'type': 'number',
                        'value': '1499257647490662971'
                    }]
                });
            });

            it('should compose an unicode search command', () => {
                expect(br._buildSEARCHCommand({
                    body: 'jõgeva'
                }, {})).to.deep.equal({
                    command: 'SEARCH',
                    attributes: [{
                        type: 'atom',
                        value: 'CHARSET'
                    }, {
                        type: 'atom',
                        value: 'UTF-8'
                    }, {
                        type: 'atom',
                        value: 'BODY'
                    }, {
                        type: 'literal',
                        value: 'jÃµgeva'
                    }]
                });
            });
        });

        describe('#_parseSEARCH', () => {
            it('should parse SEARCH response', () => {
                expect(br._parseSEARCH({
                    payload: {
                        SEARCH: [{
                            attributes: [{
                                value: 5
                            }, {
                                value: 7
                            }]
                        }, {
                            attributes: [{
                                value: 6
                            }]
                        }]
                    }
                })).to.deep.equal([5, 6, 7]);
            });

            it('should parse empty SEARCH response', () => {
                expect(br._parseSEARCH({
                    payload: {
                        SEARCH: [{
                            command: 'SEARCH',
                            tag: '*'
                        }]
                    }
                })).to.deep.equal([]);
            });
        });

        describe('#_buildSTORECommand', () => {
            it('should compose a store command from an array', () => {
                expect(br._buildSTORECommand('1,2,3', 'FLAGS', ['a', 'b'], {})).to.deep.equal({
                    command: 'STORE',
                    attributes: [{
                            'type': 'sequence',
                            'value': '1,2,3'
                        }, {
                            'type': 'atom',
                            'value': 'FLAGS'
                        },
                        [{
                            'type': 'atom',
                            'value': 'a'
                        }, {
                            'type': 'atom',
                            'value': 'b'
                        }]
                    ]
                });
            });

            it('should compose a store set flags command', () => {
                expect(br._buildSTORECommand('1,2,3', 'FLAGS', ['a', 'b'], {})).to.deep.equal({
                    command: 'STORE',
                    attributes: [{
                            'type': 'sequence',
                            'value': '1,2,3'
                        }, {
                            'type': 'atom',
                            'value': 'FLAGS'
                        },
                        [{
                            'type': 'atom',
                            'value': 'a'
                        }, {
                            'type': 'atom',
                            'value': 'b'
                        }]
                    ]
                });
            });

            it('should compose a store add flags command', () => {
                expect(br._buildSTORECommand('1,2,3', '+FLAGS', ['a', 'b'], {})).to.deep.equal({
                    command: 'STORE',
                    attributes: [{
                            'type': 'sequence',
                            'value': '1,2,3'
                        }, {
                            'type': 'atom',
                            'value': '+FLAGS'
                        },
                        [{
                            'type': 'atom',
                            'value': 'a'
                        }, {
                            'type': 'atom',
                            'value': 'b'
                        }]
                    ]
                });
            });

            it('should compose a store remove flags command', () => {
                expect(br._buildSTORECommand('1,2,3', '-FLAGS', ['a', 'b'], {})).to.deep.equal({
                    command: 'STORE',
                    attributes: [{
                            'type': 'sequence',
                            'value': '1,2,3'
                        }, {
                            'type': 'atom',
                            'value': '-FLAGS'
                        },
                        [{
                            'type': 'atom',
                            'value': 'a'
                        }, {
                            'type': 'atom',
                            'value': 'b'
                        }]
                    ]
                });
            });

            it('should compose a store remove silent flags command', () => {
                expect(br._buildSTORECommand('1,2,3', '-FLAGS', ['a', 'b'], {
                    silent: true
                })).to.deep.equal({
                    command: 'STORE',
                    attributes: [{
                            'type': 'sequence',
                            'value': '1,2,3'
                        }, {
                            'type': 'atom',
                            'value': '-FLAGS.SILENT'
                        },
                        [{
                            'type': 'atom',
                            'value': 'a'
                        }, {
                            'type': 'atom',
                            'value': 'b'
                        }]
                    ]
                });
            });

            it('should compose a uid store flags command', () => {
                expect(br._buildSTORECommand('1,2,3', 'FLAGS', ['a', 'b'], {
                    byUid: true
                })).to.deep.equal({
                    command: 'UID STORE',
                    attributes: [{
                            'type': 'sequence',
                            'value': '1,2,3'
                        }, {
                            'type': 'atom',
                            'value': 'FLAGS'
                        },
                        [{
                            'type': 'atom',
                            'value': 'a'
                        }, {
                            'type': 'atom',
                            'value': 'b'
                        }]
                    ]
                });
            });

        });

        describe('#_changeState', () => {
            it('should set the state value', () => {
                br._changeState(12345);

                expect(br.state).to.equal(12345);
            });

            it('should emit onclosemailbox if mailbox was closed', () => {
                sinon.stub(br, 'onclosemailbox');
                br.state = br.STATE_SELECTED;
                br.selectedMailbox = 'aaa';

                br._changeState(12345);

                expect(br.selectedMailbox).to.be.false;
                expect(br.onclosemailbox.withArgs('aaa').callCount).to.equal(1);
                br.onclosemailbox.restore();
            });
        });

        describe('#_ensurePath', () => {
            it('should create the path if not present', () => {
                var tree = {
                    children: []
                };
                expect(br._ensurePath(tree, 'hello/world', '/')).to.deep.equal({
                    name: 'world',
                    delimiter: '/',
                    path: 'hello/world',
                    children: []
                });
                expect(tree).to.deep.equal({
                    children: [{
                        name: 'hello',
                        delimiter: '/',
                        path: 'hello',
                        children: [{
                            name: 'world',
                            delimiter: '/',
                            path: 'hello/world',
                            children: []
                        }]
                    }]
                });
            });

            it('should return existing path if possible', () => {
                var tree = {
                    children: [{
                        name: 'hello',
                        delimiter: '/',
                        path: 'hello',
                        children: [{
                            name: 'world',
                            delimiter: '/',
                            path: 'hello/world',
                            children: [],
                            abc: 123
                        }]
                    }]
                };
                expect(br._ensurePath(tree, 'hello/world', '/')).to.deep.equal({
                    name: 'world',
                    delimiter: '/',
                    path: 'hello/world',
                    children: [],
                    abc: 123
                });
            });

            it('should handle case insensitive Inbox', () => {
                var tree = {
                    children: []
                };
                expect(br._ensurePath(tree, 'Inbox/world', '/')).to.deep.equal({
                    name: 'world',
                    delimiter: '/',
                    path: 'Inbox/world',
                    children: []
                });
                expect(br._ensurePath(tree, 'INBOX/worlds', '/')).to.deep.equal({
                    name: 'worlds',
                    delimiter: '/',
                    path: 'INBOX/worlds',
                    children: []
                });

                expect(tree).to.deep.equal({
                    children: [{
                        name: 'Inbox',
                        delimiter: '/',
                        path: 'Inbox',
                        children: [{
                            name: 'world',
                            delimiter: '/',
                            path: 'Inbox/world',
                            children: []
                        }, {
                            name: 'worlds',
                            delimiter: '/',
                            path: 'INBOX/worlds',
                            children: []
                        }]
                    }]
                });
            });
        });

        describe('#_checkSpecialUse', () => {
            it('should exist', () => {
                expect(br._checkSpecialUse({
                    flags: ['test', '\\All']
                })).to.equal('\\All');

            });

            it('should fail for non-existent flag', () => {
                expect(false, br._checkSpecialUse({}));
            });

            it('should fail for invalid flag', () => {
                expect(br._checkSpecialUse({
                    flags: ['test']
                })).to.be.false;
            });

            it('should return special use flag if match is found', () => {
                expect(br._checkSpecialUse({
                    name: 'test'
                })).to.be.false;
                expect(br._checkSpecialUse({
                    name: 'Praht'
                })).to.equal('\\Trash');
            });
        });

        describe('#_buildXOAuth2Token', () => {
            it('should return base64 encoded XOAUTH2 token', () => {
                expect(br._buildXOAuth2Token('user@host', 'abcde')).to.equal('dXNlcj11c2VyQGhvc3QBYXV0aD1CZWFyZXIgYWJjZGUBAQ==');
            });
        });

        describe('untagged updates', () => {
            it('should receive information about untagged exists', (done) => {
                br.client._connectionReady = true;
                br.onupdate = (type, value) => {
                    expect(type).to.equal('exists');
                    expect(value).to.equal(123);
                    done();
                };
                br.client._addToServerQueue('* 123 EXISTS');
            });

            it('should receive information about untagged expunge', (done) => {
                br.client._connectionReady = true;
                br.onupdate = (type, value) => {
                    expect(type).to.equal('expunge');
                    expect(value).to.equal(456);
                    done();
                };
                br.client._addToServerQueue('* 456 EXPUNGE');
            });

            it('should receive information about untagged fetch', (done) => {
                br.client._connectionReady = true;
                br.onupdate = (type, value) => {
                    expect(type).to.equal('fetch');
                    expect(value).to.deep.equal({
                        '#': 123,
                        'flags': ['\\Seen'],
                        'modseq': '4'
                    });
                    done();
                };
                br.client._addToServerQueue('* 123 FETCH (FLAGS (\\Seen) MODSEQ (4))');
            });
        });
    });
}));
