import { expect, use } from 'chai';
import * as sinon from 'sinon';
import sinonChai from 'sinon-chai';
import chaiAsPromised from 'chai-as-promised';
import { getSalesforceConnection } from '../../src/core/auth.js';
// Importación corregida del logger
import { logger } from '../../src/core/logger.js';
import * as jsforce from 'jsforce';
import { Connection, IdentityInfo, UserInfo } from 'jsforce';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

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

    beforeEach(() => {
        sandbox = sinon.createSandbox();
        loggerInfoStub = sandbox.stub(logger, 'info');
        loggerErrorStub = sandbox.stub(logger, 'error');
        loggerDebugStub = sandbox.stub(logger, 'debug');
        
        // Stub the jsforce.Connection class itself
        connStub = sandbox.createStubInstance(Connection);
        jsforceConnectionStub = sandbox.stub(jsforce, 'Connection').returns(connStub);

        fsReadFileStub = sandbox.stub(fs, 'readFile');
        osHomedirStub = sandbox.stub(os, 'homedir').returns('/home/user');
    });

    afterEach(() => {
        sandbox.restore();
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

        fsReadFileStub.withArgs(path.join('/home/user', '.sfdx', `${alias}.json`), 'utf-8')
            .resolves(JSON.stringify(sfdxAuthInfo));
        
        connStub.identity.resolves(mockIdentityInfo); // Simulate successful identity check

        const result = await getSalesforceConnection(alias, config);

        expect(result).to.equal(connStub);
        expect(fsReadFileStub).to.have.been.calledWith(path.join('/home/user', '.sfdx', `${alias}.json`), 'utf-8');
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
            password: password, // This field is usually not present in real results, but for stubbing...
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
            } as UserInfo // Cast to UserInfo to satisfy type checking
        };

        // Simulate SFDX alias failure (file not found)
        fsReadFileStub.withArgs(path.join('/home/user', '.sfdx', `${alias}.json`), 'utf-8')
            .rejects({ code: 'ENOENT' });

        connStub.login.withArgs(username, password).resolves(mockLoginResult);

        const result = await getSalesforceConnection(alias, config);

        expect(result).to.equal(connStub);
        expect(fsReadFileStub).to.have.been.calledOnce; // Attempted SFDX alias
        expect(loggerDebugStub).to.have.been.calledWith(sinon.match(/No se pudo conectar con el alias SFDX/));
        expect(jsforceConnectionStub).to.have.been.calledWithNew;
        expect(jsforceConnectionStub).to.have.been.calledWith({ loginUrl: loginUrl });
        expect(connStub.login).to.have.been.calledWith(username, password);
        expect(loggerInfoStub).to.have.been.calledWith(`Conexión establecida para el alias '${alias}' usando credenciales del archivo de configuración.`);
    });

    it('should throw an error if no valid credentials are found', async () => {
        const alias = 'unknownOrg';
        const config = { orgs: {} };

        // Simulate SFDX alias failure (file not found)
        fsReadFileStub.withArgs(path.join('/home/user', '.sfdx', `${alias}.json`), 'utf-8')
            .rejects({ code: 'ENOENT' });

        await expect(getSalesforceConnection(alias, config)).to.be.rejectedWith(
            `No se encontraron credenciales válidas para el alias '${alias}'. Compruebe sus alias de SFDX o el archivo de configuración.`
        );
        expect(loggerDebugStub).to.have.been.calledWith(sinon.match(/No se pudo conectar con el alias SFDX/));
        expect(loggerErrorStub).to.not.have.been.called; // No config.json error if no credentials provided
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

        // Simulate SFDX alias failure (file not found)
        fsReadFileStub.withArgs(path.join('/home/user', '.sfdx', `${alias}.json`), 'utf-8')
            .rejects({ code: 'ENOENT' });

        connStub.login.withArgs(username, password).rejects(loginError);

        await expect(getSalesforceConnection(alias, config)).to.be.rejectedWith(loginError);
        expect(loggerDebugStub).to.have.been.calledWith(sinon.match(/No se pudo conectar con el alias SFDX/));
        expect(jsforceConnectionStub).to.have.been.calledWithNew;
        expect(jsforceConnectionStub).to.have.been.calledWith({ loginUrl: 'https://login.salesforce.com' });
        expect(connStub.login).to.have.been.calledWith(username, password);
        expect(loggerErrorStub).to.have.been.calledWith(`Fallo al iniciar sesión con las credenciales de config.json para el alias '${alias}': ${loginError.message}`);
    });

    it('should handle SFDX alias file parsing error', async () => {
        const alias = 'badJsonOrg';
        const config = { orgs: {} };

        fsReadFileStub.withArgs(path.join('/home/user', '.sfdx', `${alias}.json`), 'utf-8')
            .resolves('invalid json');

        await expect(getSalesforceConnection(alias, config)).to.be.rejectedWith(
            `No se encontraron credenciales válidas para el alias '${alias}'. Compruebe sus alias de SFDX o el archivo de configuración.`
        );
        expect(loggerDebugStub).to.have.been.calledWith(sinon.match(/No se pudo conectar con el alias SFDX/));
        expect(loggerErrorStub).to.not.have.been.called; // Error is caught internally by connectWithSfdxAlias
    });

    it('should handle SFDX alias file missing accessToken or instanceUrl', async () => {
        const alias = 'incompleteAuthOrg';
        const config = { orgs: {} };
        const sfdxAuthInfo = { accessToken: 'testAccessToken' }; // Missing instanceUrl

        fsReadFileStub.withArgs(path.join('/home/user', '.sfdx', `${alias}.json`), 'utf-8')
            .resolves(JSON.stringify(sfdxAuthInfo));

        await expect(getSalesforceConnection(alias, config)).to.be.rejectedWith(
            `No se encontraron credenciales válidas para el alias '${alias}'. Compruebe sus alias de SFDX o el archivo de configuración.`
        );
        expect(loggerDebugStub).to.have.been.calledWith(sinon.match(/No se pudo conectar con el alias SFDX/));
        expect(loggerErrorStub).to.not.have.been.called;
    });
});