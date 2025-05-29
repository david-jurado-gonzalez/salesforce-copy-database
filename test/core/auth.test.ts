import { expect, use } from 'chai';
import * as sinon from 'sinon';
import sinonChai from 'sinon-chai';
import chaiAsPromised from 'chai-as-promised';
import rewiremock from 'rewiremock';
import * as path from 'path'; // Añadimos esta importación

// Original imports - these will be handled by rewiremock or imported dynamically
// import { getSalesforceConnection } from '../../src/core/auth.js';
// import { logger } from '../../src/core/logger.js';
// import * as jsforce from 'jsforce';
import { Connection, IdentityInfo, UserInfo } from 'jsforce'; // Keep types
// import * as fs from 'fs/promises';
// import * as os from 'os';
// import * as path from 'path';

use(sinonChai);
use(chaiAsPromised);

describe('getSalesforceConnection', () => {
    let sandbox: sinon.SinonSandbox;
    let loggerInfoStub: sinon.SinonStub;
    let loggerErrorStub: sinon.SinonStub;
    let loggerDebugStub: sinon.SinonStub;
    let connStub: sinon.SinonStubbedInstance<Connection>;
    let fsReadFileStub: sinon.SinonStub;
    let osHomedirStub: sinon.SinonStub;
    let jsforceConnectionStub: sinon.SinonStub;

    // These will be imported dynamically or proxied
    let authModule: typeof import('../../src/core/auth.js');
    let authInstance: import('../../src/core/auth.js').Auth;
    let loggerModule: typeof import('../../src/core/logger.js');
    let jsforceModule: any; // Changed to any
    let fsPromisesModule: typeof import('fs/promises');
    let osModule: typeof import('os');
    let pathModule: typeof import('path');

    beforeEach(async () => {
        sandbox = sinon.createSandbox();
        
        // Enable rewiremock
        rewiremock.enable();

        // Configure mocks for logger
        loggerInfoStub = sandbox.stub();
        loggerErrorStub = sandbox.stub();
        loggerDebugStub = sandbox.stub();
        rewiremock(() => import('../../src/core/logger.js')).with({
            Logger: class {
                info = loggerInfoStub;
                error = loggerErrorStub;
                debug = loggerDebugStub;
                warn = sandbox.stub(); // Add other methods if used by Auth class
                getLogLevel = sandbox.stub().returns('info');
                setLogLevel = sandbox.stub();
            } as any
        });

        // Configure mocks for jsforce Connection
        connStub = {
            login: sandbox.stub(),
            identity: sandbox.stub(),
            version: '1.0.0',
            loginUrl: 'https://login.salesforce.com',
            instanceUrl: 'https://test.salesforce.com',
            accessToken: 'dummy-token',
        } as unknown as sinon.SinonStubbedInstance<Connection>;

        jsforceConnectionStub = sandbox.stub().returns(connStub);
        rewiremock(() => import('jsforce')).with({
            Connection: jsforceConnectionStub,
        } as any);

        // Configure mocks for fs/promises
        fsReadFileStub = sandbox.stub();
        rewiremock(() => import('fs/promises')).with({
            readFile: fsReadFileStub
        });

        // Configure mocks for os
        osHomedirStub = sandbox.stub();
        rewiremock(() => import('os')).with({
            homedir: osHomedirStub
        });

        // Configure mocks for path
        rewiremock(() => import('path')).with({
            join: path.join // Usar directamente path.join
        });

        // Dynamically import the module under test AFTER mocks are configured
        const tempAuthModule = await rewiremock.module(() => import('../../src/core/auth.js'));
        authModule = tempAuthModule;
        authInstance = new tempAuthModule.Auth();
        loggerModule = await rewiremock.module(() => import('../../src/core/logger.js'));
        jsforceModule = await rewiremock.module(() => import('jsforce'));
        fsPromisesModule = await rewiremock.module(() => import('fs/promises'));
        osModule = await rewiremock.module(() => import('os'));
        pathModule = await rewiremock.module(() => import('path'));

        osHomedirStub.returns('/home/user');
    });

    afterEach(() => {
        sandbox.restore();
        rewiremock.disable();
    });

    it('should successfully authenticate using SFDX alias if available', async () => {
        const alias = 'testOrg';
        const config = { orgs: {} };
        const sfdxAuthInfo = { accessToken: 'testAccessToken', instanceUrl: 'https://test.salesforce.com' };
        const mockIdentityInfo: IdentityInfo = {
            id: 'testId',
            user_id: 'testUserId',
            organization_id: 'testOrgId',
            username: 'test@example.com',
            display_name: 'Test User',
            email: 'test@example.com',
            nick_name: 'testNick',
            user_type: 'STANDARD',
            language: 'en_US',
            photos: { picture: 'url', thumbnail: 'url' },
            urls: {
                enterprise: 'url',
                metadata: 'url',
                partner: 'url',
                rest: 'url',
                sobjects: 'url',
                search: 'url',
                query: 'url',
                profile: 'url'
            }
        };

        fsReadFileStub.withArgs(pathModule.join('/home/user', '.sfdx', `${alias}.json`), 'utf-8')
            .resolves(JSON.stringify(sfdxAuthInfo));
        
        connStub.identity.resolves(mockIdentityInfo);

        const result = await authInstance.getSalesforceConnection(alias, config);

        expect(result).to.equal(connStub);
        expect(fsReadFileStub).to.have.been.calledWith(pathModule.join('/home/user', '.sfdx', `${alias}.json`), 'utf-8');
        expect(loggerInfoStub).to.have.been.calledWith(`Conexión establecida para el alias '${alias}' usando credenciales locales de SFDX.`);
        expect(connStub.identity).to.have.been.calledOnce;
        expect(jsforceConnectionStub).to.have.been.calledWithNew;
        expect(jsforceConnectionStub).to.have.been.calledWith({
            instanceUrl: sfdxAuthInfo.instanceUrl,
            accessToken: sfdxAuthInfo.accessToken,
        });
    });

    it('should fall back to config.json credentials if SFDX alias fails', async () => {
        const alias = 'testOrg';
        const username = 'test@example.com';
        const password = 'password123';
        const loginUrl = 'https://login.salesforce.com';
        const config = {
            orgs: {
                [alias]: { username, password, loginUrl }
            }
        };
        const mockLoginResult = {
            id: '00Dxxxxxxxxxxxxxxx',
            organizationId: '00Dxxxxxxxxxxxxxxx',
            url: 'https://test.salesforce.com',
            username: username,
            password: password,
            accessToken: '00Dxxxxxxxxxxxxxxx',
            instanceUrl: 'https://test.salesforce.com',
            serverUrl: 'https://test.salesforce.com',
            userInfo: {
                id: '005xxxxxxxxxxxxxxx',
                organizationId: '00Dxxxxxxxxxxxxxxx',
                url: 'https://test.salesforce.com',
                username: username,
                password: password,
                accessToken: '00Dxxxxxxxxxxxxxxx',
                instanceUrl: 'https://test.salesforce.com',
                serverUrl: 'https://test.salesforce.com',
            } as UserInfo
        };

        fsReadFileStub.withArgs(pathModule.join('/home/user', '.sfdx', `${alias}.json`), 'utf-8')
            .rejects({ code: 'ENOENT' });

        connStub.login.withArgs(username, password).resolves(mockLoginResult);

        const result = await authInstance.getSalesforceConnection(alias, config);

        expect(result).to.equal(connStub);
        expect(fsReadFileStub).to.have.been.calledOnce;
        expect(loggerDebugStub).to.have.been.calledWith(sinon.match(/No se pudo conectar con el alias SFDX/));
        expect(jsforceConnectionStub).to.have.been.calledWithNew;
        expect(jsforceConnectionStub).to.have.been.calledWith({ loginUrl: loginUrl });
        expect(connStub.login).to.have.been.calledWith(username, password);
        expect(loggerInfoStub).to.have.been.calledWith(`Conexión establecida para el alias '${alias}' usando credenciales del archivo de configuración.`);
    });

    it('should throw an error if no valid credentials are found', async () => {
        const alias = 'unknownOrg';
        const config = { orgs: {} };

        fsReadFileStub.withArgs(pathModule.join('/home/user', '.sfdx', `${alias}.json`), 'utf-8')
            .rejects({ code: 'ENOENT' });

        await expect(authInstance.getSalesforceConnection(alias, config)).to.be.rejectedWith(
            `No se encontraron credenciales válidas para el alias '${alias}'. Compruebe sus alias de SFDX o el archivo de configuración.`
        );
        expect(loggerDebugStub).to.have.been.calledWith(sinon.match(/No se pudo conectar con el alias SFDX/));
        expect(loggerErrorStub).to.not.have.been.called;
    });

    it('should throw an error if config.json credentials fail', async () => {
        const alias = 'testOrg';
        const username = 'test@example.com';
        const password = 'wrongpassword';
        const config = {
            orgs: {
                [alias]: { username, password }
            }
        };
        const loginError = new Error('INVALID_LOGIN');

        fsReadFileStub.withArgs(pathModule.join('/home/user', '.sfdx', `${alias}.json`), 'utf-8')
            .rejects({ code: 'ENOENT' });

        connStub.login.withArgs(username, password).rejects(loginError);

        await expect(authInstance.getSalesforceConnection(alias, config)).to.be.rejectedWith(loginError);
        expect(loggerDebugStub).to.have.been.calledWith(sinon.match(/No se pudo conectar con el alias SFDX/));
        expect(jsforceConnectionStub).to.have.been.calledWithNew;
        expect(jsforceConnectionStub).to.have.been.calledWith({ loginUrl: 'https://login.salesforce.com' });
        expect(connStub.login).to.have.been.calledWith(username, password);
        expect(loggerErrorStub).to.have.been.calledWith(`Fallo al iniciar sesión con las credenciales de config.json para el alias '${alias}': ${loginError.message}`);
    });

    it('should handle SFDX alias file parsing error', async () => {
        const alias = 'badJsonOrg';
        const config = { orgs: {} };

        fsReadFileStub.withArgs(pathModule.join('/home/user', '.sfdx', `${alias}.json`), 'utf-8')
            .resolves('invalid json');

        await expect(authInstance.getSalesforceConnection(alias, config)).to.be.rejectedWith(
            `No se encontraron credenciales válidas para el alias '${alias}'. Compruebe sus alias de SFDX o el archivo de configuración.`
        );
        expect(loggerDebugStub).to.have.been.calledWith(sinon.match(/No se pudo conectar con el alias SFDX/));
        expect(loggerErrorStub).to.not.have.been.called;
    });

    it('should handle SFDX alias file missing accessToken or instanceUrl', async () => {
        const alias = 'incompleteAuthOrg';
        const config = { orgs: {} };
        const sfdxAuthInfo = { accessToken: 'testAccessToken' }; // Missing instanceUrl

        fsReadFileStub.withArgs(pathModule.join('/home/user', '.sfdx', `${alias}.json`), 'utf-8')
            .resolves(JSON.stringify(sfdxAuthInfo));

        await expect(authInstance.getSalesforceConnection(alias, config)).to.be.rejectedWith(
            `No se encontraron credenciales válidas para el alias '${alias}'. Compruebe sus alias de SFDX o el archivo de configuración.`
        );
        expect(loggerDebugStub).to.have.been.calledWith(sinon.match(/No se pudo conectar con el alias SFDX/));
        expect(loggerErrorStub).to.not.have.been.called;
    });
});